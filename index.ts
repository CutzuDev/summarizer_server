import { pdfToText } from "pdf-ts";
import { GoogleGenAI } from "@google/genai";
import { Readable } from "stream";

const ai = new GoogleGenAI({
  apiKey: process.env.KEY,
});

async function processPdf(pdfBuffer: ArrayBuffer) {
  const pdfUint8Array = new Uint8Array(pdfBuffer);
  const text = await pdfToText(pdfUint8Array);
  return text;
}

async function getSummary(text: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `Summarize the following text by extracting the main points, author, and date. Format your response as simple HTML using only h1, ul, and li elements with these styles:

h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937; }
ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem; }
li { margin-bottom: 0.5rem; }

Your response should look exactly like this (but with the actual content filled in):

<h1 style="font-size: 1.875rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Main Points</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Point 1</li>
  <li style="margin-bottom: 0.5rem;">Point 2</li>
</ul>

<h1 style="font-size: 1.875rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Author</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Author name</li>
</ul>

<h1 style="font-size: 1.875rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Date</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Publication date</li>
</ul>

TEXT TO SUMMARIZE: ${text}
`,
  });

  // Clean the response to remove code block markers
  let cleanedResponse = response.text || "No summary generated";

  // Log the original response for debugging
  console.log("[Original AI Response]:", response.text);

  // If response contains code blocks, extract the content
  if (cleanedResponse.includes("```")) {
    const codeBlockMatch = cleanedResponse.match(/```(?:html)?([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      cleanedResponse = codeBlockMatch[1].trim();
    }
  }

  // Log the cleaned response for debugging
  console.log("[Cleaned Response]:", cleanedResponse);

  return cleanedResponse;
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;
    const ipAddress = req.headers.get("x-forwarded-for") || "unknown";

    console.log(
      `[${new Date().toISOString()}] ${method} ${
        url.pathname
      } - Client: ${ipAddress}`
    );

    // Handle preflight CORS requests
    if (method === "OPTIONS") {
      console.log(
        `[${new Date().toISOString()}] Handling OPTIONS preflight request`
      );
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400", // 24 hours
        },
      });
    }

    // Common headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle API route for PDF processing
    if (url.pathname === "/api/process-pdf" && method === "POST") {
      try {
        console.log(
          `[${new Date().toISOString()}] Processing PDF upload request`
        );
        // Get the file from the request
        const formData = await req.formData();
        const file = formData.get("pdf") as File;

        if (!file) {
          console.log(
            `[${new Date().toISOString()}] Error: No PDF file uploaded`
          );
          return new Response("No PDF file uploaded", {
            status: 400,
            headers: corsHeaders,
          });
        }

        console.log(
          `[${new Date().toISOString()}] PDF received: ${file.name}, size: ${
            file.size
          } bytes`
        );

        // Process the PDF
        const pdfBuffer = await file.arrayBuffer();
        console.log(
          `[${new Date().toISOString()}] PDF loaded into buffer, extracting text...`
        );
        const text = await processPdf(pdfBuffer);
        console.log(
          `[${new Date().toISOString()}] Text extraction complete, generating summary...`
        );
        const summary = await getSummary(text);
        console.log(
          `[${new Date().toISOString()}] Summary generation complete, returning response`
        );

        // Return the summary
        return new Response(summary, {
          headers: {
            "Content-Type": "text/plain",
            ...corsHeaders,
          },
        });
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Error processing PDF:`,
          error
        );
        return new Response(
          "Error processing PDF: " + (error as Error).message,
          {
            status: 500,
            headers: corsHeaders,
          }
        );
      }
    }

    // Handle root route - serve a simple HTML form
    if (url.pathname === "/" && method === "GET") {
      console.log(`[${new Date().toISOString()}] Serving homepage`);
      return new Response(
        `
        <!DOCTYPE html>
        <html>
        <head>
          <title>PDF Summarizer</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            form { margin: 20px 0; }
            button { padding: 10px 15px; background: #4285f4; color: white; border: none; cursor: pointer; }
            #result { white-space: pre-wrap; border: 1px solid #ddd; padding: 15px; margin-top: 20px; }
            h1 { font-size: 1.875rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937; }
            ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem; }
            li { margin-bottom: 0.5rem; }
          </style>
        </head>
        <body>
          <h1>PDF Summarizer</h1>
          <form id="uploadForm">
            <input type="file" name="pdf" accept=".pdf" required>
            <button type="submit">Summarize PDF</button>
          </form>
          <div id="loading" style="display: none;">Processing, please wait...</div>
          <div id="result"></div>
          
          <script>
            document.getElementById('uploadForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              const form = e.target;
              const formData = new FormData(form);
              
              document.getElementById('loading').style.display = 'block';
              document.getElementById('result').innerHTML = '';
              
              try {
                const response = await fetch('/api/process-pdf', {
                  method: 'POST',
                  body: formData
                });
                
                if (!response.ok) {
                  throw new Error('Server error: ' + response.status);
                }
                
                const result = await response.text();
                document.getElementById('result').innerHTML = result;
              } catch (error) {
                document.getElementById('result').innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
              } finally {
                document.getElementById('loading').style.display = 'none';
              }
            });
          </script>
        </body>
        </html>
      `,
        {
          headers: {
            "Content-Type": "text/html",
            ...corsHeaders,
          },
        }
      );
    }

    console.log(
      `[${new Date().toISOString()}] Not Found: ${method} ${url.pathname}`
    );
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders,
    });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
