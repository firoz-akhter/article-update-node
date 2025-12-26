// const express = require("express");
// const cors = require("cors");
// const morgan = require("morgan");

// const app = express();

// app.use(cors());
// app.use(morgan("dev"));

// require("dotenv").config();

// app.use(express.json());

// app.get("/", (req, res) => {
//   res.json({ message: "Node.js server is running 🚀" });
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import OpenAI from "openai";
import puppeteer from "puppeteer";

dotenv.config();

// Configuration
const config = {
  laravelApiUrl: process.env.LARAVEL_API_URL || "http://localhost:8000/api",
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ============================================
// 1. Fetch Latest Article from Laravel API
// ============================================
async function fetchLatestArticle() {
  try {
    console.log("📥 Fetching latest article from Laravel API...");

    const response = await axios.get(`${config.laravelApiUrl}/articles`, {
      params: { per_page: 1 },
    });

    if (!response.data.success || !response.data.articles.data.length) {
      throw new Error("No articles found");
    }

    const article = response.data.articles.data[0];
    console.log(`✅ Found article: "${article.title}"`);

    return article;
  } catch (error) {
    console.error("❌ Error fetching article:", error.message);
    throw error;
  }
}

// ============================================
// 2. Search Article Title on Google
// ============================================
async function searchGoogleForArticles(query) {
  try {
    console.log(`🔍 Searching Google for: "${query}"`);

    // Using Google Custom Search API
    const url = "https://www.googleapis.com/customsearch/v1";
    const params = {
      key: config.googleApiKey,
      cx: config.googleSearchEngineId,
      q: query,
      num: 10, // Get 10 results to filter through
    };

    const response = await axios.get(url, { params });

    if (!response.data.items || response.data.items.length === 0) {
      throw new Error("No search results found");
    }

    // Filter for blog/article links (exclude video, social media, etc.)
    const articleLinks = response.data.items
      .filter((item) => {
        const url = item.link.toLowerCase();
        const excludePatterns = [
          "youtube.com",
          "facebook.com",
          "twitter.com",
          "instagram.com",
          "linkedin.com",
          "reddit.com",
          "pinterest.com",
          ".pdf",
          "/video/",
          "/watch",
        ];

        return !excludePatterns.some((pattern) => url.includes(pattern));
      })
      .slice(0, 2)
      .map((item) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
      }));

    console.log(`✅ Found ${articleLinks.length} article links:`);
    articleLinks.forEach((link, i) => {
      console.log(`   ${i + 1}. ${link.title}`);
      console.log(`      ${link.url}`);
    });

    return articleLinks;
  } catch (error) {
    console.error("❌ Error searching Google:", error.message);

    // Fallback: Use Puppeteer to scrape Google directly
    console.log("🔄 Trying fallback method with Puppeteer...");
    return await searchGoogleWithPuppeteer(query);
  }
}

// ============================================
// 2b. Fallback: Scrape Google with Puppeteer
// ============================================
async function searchGoogleWithPuppeteer(query) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query
    )}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    // Extract search results
    const results = await page.evaluate(() => {
      const items = [];
      const searchResults = document.querySelectorAll("div.g");

      for (let i = 0; i < Math.min(searchResults.length, 10); i++) {
        const result = searchResults[i];
        const titleEl = result.querySelector("h3");
        const linkEl = result.querySelector("a");
        const snippetEl = result.querySelector(".VwiC3b");

        if (titleEl && linkEl) {
          items.push({
            title: titleEl.innerText,
            url: linkEl.href,
            snippet: snippetEl ? snippetEl.innerText : "",
          });
        }
      }

      return items;
    });

    // Filter and return top 2 articles
    const articleLinks = results
      .filter((item) => {
        const url = item.url.toLowerCase();
        const excludePatterns = [
          "youtube.com",
          "facebook.com",
          "twitter.com",
          "instagram.com",
          "linkedin.com",
          "reddit.com",
          ".pdf",
          "/video/",
          "/watch",
        ];
        return !excludePatterns.some((pattern) => url.includes(pattern));
      })
      .slice(0, 2);

    console.log(`✅ Found ${articleLinks.length} article links (Puppeteer)`);
    return articleLinks;
  } finally {
    await browser.close();
  }
}

// ============================================
// 3. Scrape Article Content
// ============================================
async function scrapeArticleContent(url) {
  try {
    console.log(`📄 Scraping content from: ${url}`);

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);

    // Remove unwanted elements
    $(
      "script, style, nav, header, footer, aside, .advertisement, .ad, .social-share, .comments, .related-posts"
    ).remove();

    // Try multiple selectors to find main content
    const selectors = [
      "article",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".content",
      "main",
      '[role="main"]',
    ];

    let content = "";

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = convertToMarkdown($, element);
        if (content.length > 500) {
          break;
        }
      }
    }

    // Fallback: convert body to markdown
    if (content.length < 500) {
      content = convertToMarkdown($, $("body"));
    }

    // Clean up excessive whitespace
    content = content
      .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
      .trim();

    // Limit content to reasonable size
    if (content.length > 8000) {
      content = content.substring(0, 8000) + "...";
    }

    console.log(`✅ Scraped ${content.length} characters (markdown format)`);

    return content;
  } catch (error) {
    console.error(`❌ Error scraping ${url}:`, error.message);
    return null;
  }
}

// New helper function to convert HTML to markdown-like format
function convertToMarkdown($, element) {
  const parts = [];

  element
    .find("h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote")
    .each((i, el) => {
      const $el = $(el);
      const tagName = el.tagName.toLowerCase();
      const text = $el.text().trim();

      if (!text || text.length < 10) return; // Skip empty or very short elements

      switch (tagName) {
        case "h1":
          parts.push(`# ${text}\n`);
          break;
        case "h2":
          parts.push(`## ${text}\n`);
          break;
        case "h3":
          parts.push(`### ${text}\n`);
          break;
        case "h4":
          parts.push(`#### ${text}\n`);
          break;
        case "h5":
        case "h6":
          parts.push(`##### ${text}\n`);
          break;
        case "p":
          // Don't add paragraphs that are inside lists
          if (!$el.parent().is("li")) {
            parts.push(`${text}\n`);
          }
          break;
        case "li":
          // Check if it's in an ordered or unordered list
          const isOrdered = $el.parent().is("ol");
          const prefix = isOrdered ? "1. " : "• ";
          parts.push(`${prefix}${text}\n`);
          break;
        case "blockquote":
          parts.push(`> ${text}\n`);
          break;
        case "ul":
        case "ol":
          // Lists are handled by their <li> children
          break;
      }
    });

  return parts.join("\n");
}

// ============================================
// 4. Use LLM to Rewrite Article
// ============================================
async function rewriteArticleWithLLM(originalArticle, referenceArticles) {
  try {
    console.log("🤖 Rewriting article with LLM...");
    console.log("originalArticle", originalArticle);
    console.log("referenceArticles", referenceArticles);

    const prompt = `You are an expert content writer and SEO specialist. 

          TASK: Rewrite the ORIGINAL ARTICLE below to match the style, formatting, and quality of the TOP-RANKING REFERENCE ARTICLES.

          ORIGINAL ARTICLE:
          Title: ${originalArticle.title}
          Content:
          ${originalArticle.full_content || originalArticle.excerpt}

          REFERENCE ARTICLE 1 (Top Ranking):
          Title: ${referenceArticles[0].title}
          URL: ${referenceArticles[0].url}
          Content:
          ${referenceArticles[0].content}

          REFERENCE ARTICLE 2 (Top Ranking):
          Title: ${referenceArticles[1].title}
          URL: ${referenceArticles[1].url}
          Content:
          ${referenceArticles[1].content}

          INSTRUCTIONS:
          1. Analyze the writing style, tone, structure, and formatting of the reference articles
          2. Rewrite the original article to match that style while keeping the same core topic
          3. Use similar heading structures (H2, H3) as the reference articles
          4. Match the depth and comprehensiveness of the reference articles
          5. Improve SEO optimization based on how the reference articles are structured
          6. Keep the content engaging, informative, and well-organized
          7. Use markdown formatting for headings (##, ###)
          8. Make it at least as detailed as the reference articles

          OUTPUT FORMAT (in markdown):
          # [Improved Title]

          [Introduction paragraph]

          ## [First Main Section]

          [Content...]

          ### [Subsection if needed]

          [Content...]

          ## [Second Main Section]

          [Content...]

          [Continue with more sections as appropriate...]

          ## Conclusion

          [Concluding thoughts]

          ---

          ONLY output the rewritten article content in markdown format. Do NOT include any meta-commentary or explanations.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content:
            "You are an expert content writer specializing in SEO-optimized articles. You analyze top-ranking content and recreate similar quality.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const rewrittenContent = completion.choices[0].message.content.trim();

    console.log("✅ Article rewritten successfully");
    console.log(`📊 New content length: ${rewrittenContent.length} characters`);

    return rewrittenContent;
  } catch (error) {
    console.error("❌ Error rewriting article with LLM:", error.message);
    throw error;
  }
}

// ============================================
// 5. Add References Section
// ============================================
function addReferences(content, referenceArticles) {
  const referencesSection = `
                ---

                ## References

                This article was optimized based on analysis of top-ranking content:

                1. [${referenceArticles[0].title}](${referenceArticles[0].url})
                2. [${referenceArticles[1].title}](${referenceArticles[1].url})

                *Last updated: ${new Date().toLocaleDateString()}*
                `;

  return content + referencesSection;
}

// ============================================
// 6. Update Article via Laravel API
// ============================================
async function updateArticle(articleId, updatedContent, referenceArticles) {
  try {
    console.log(`💾 Updating article ID ${articleId} via API...`);

    // Extract title from markdown (first # heading)
    const titleMatch = updatedContent.match(/^#\s+(.+)$/m);
    const newTitle = titleMatch ? titleMatch[1] : "Updated Article";

    // Remove title from content
    const contentWithoutTitle = updatedContent.replace(/^#\s+.+$/m, "").trim();

    // Add references
    const finalContent = addReferences(contentWithoutTitle, referenceArticles);

    // Extract excerpt (first paragraph)
    const excerptMatch = finalContent.match(/^([^\n#]+)/);
    const newExcerpt = excerptMatch ? excerptMatch[1].substring(0, 200) : "";

    const response = await axios.put(
      `${config.laravelApiUrl}/articles/${articleId}`,
      {
        title: newTitle,
        excerpt: newExcerpt,
        full_content: finalContent,
      }
    );

    if (response.data.success) {
      console.log("✅ Article updated successfully!");
      console.log(`📝 New title: ${newTitle}`);
      return response.data.article;
    } else {
      throw new Error("API returned unsuccessful response");
    }
  } catch (error) {
    console.error("❌ Error updating article:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
    throw error;
  }
}

// main function for overall execution
async function main() {
  console.log("🚀 Starting Article Optimization Process...\n");

  try {
    // Step 1: Fetch latest article
    const originalArticle = await fetchLatestArticle();
    console.log("");

    // Step 2: Search Google
    const searchResults = await searchGoogleForArticles(originalArticle.title);

    if (searchResults.length < 2) {
      throw new Error("Could not find enough reference articles");
    }
    console.log("");

    // Step 3: Scrape reference articles
    console.log("📚 Scraping reference articles...");
    const referenceArticles = [];

    for (const result of searchResults) {
      const content = await scrapeArticleContent(result.url);
      if (content) {
        referenceArticles.push({
          title: result.title,
          url: result.url,
          content: content,
        });
      }

      if (referenceArticles.length >= 2) break;
    }

    if (referenceArticles.length < 2) {
      throw new Error("Could not scrape enough reference articles");
    }
    console.log("");

    // Step 4: Rewrite article with LLM
    const rewrittenContent = await rewriteArticleWithLLM(
      originalArticle,
      referenceArticles
    );
    console.log("");

    // Step 5: Update article via API
    const updatedArticle = await updateArticle(
      originalArticle.id,
      rewrittenContent,
      referenceArticles
    );

    console.log("\n✨ Process completed successfully!");
    console.log("📊 Summary:");
    console.log(`   - Original article: ${originalArticle.title}`);
    console.log(`   - Updated article: ${updatedArticle.title}`);
    console.log(
      `   - Reference articles analyzed: ${referenceArticles.length}`
    );
    console.log(
      `   - Content length: ${updatedArticle.full_content.length} characters`
    );
  } catch (error) {
    console.error("\n💥 Process failed:", error.message);
    process.exit(1);
  }
}

// Running the script
main();

export {
  fetchLatestArticle,
  searchGoogleForArticles,
  scrapeArticleContent,
  rewriteArticleWithLLM,
  updateArticle,
};
