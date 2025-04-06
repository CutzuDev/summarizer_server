import { pdfToText } from "pdf-ts";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Readable } from "stream";
import path from "path";

// Using require for node-gtts to avoid TypeScript issues
const gtts = require("node-gtts")("en");

const ai = new GoogleGenAI({
  apiKey: process.env.KEY,
});

async function processPdf(pdfBuffer: ArrayBuffer) {
  const pdfUint8Array = new Uint8Array(pdfBuffer);
  const text = await pdfToText(pdfUint8Array);
  return text;
}

async function getSummary(text: string) {
  // Set up longer timeout for Gemini API call
  const timeoutMs = 120000; // 2 minutes timeout
  
  try {
    // Create a controller for aborting the fetch if needed
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    // Make the API call with the abort signal
    console.log(`[${new Date().toISOString()}] Sending request to Gemini API`);
    const startTime = Date.now();
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Summarize the following text by extracting the main points (MINIMUM 5), author, and date. Format your response as simple HTML using only h1, ul, and li elements with these styles:

h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color:rgb(71, 72, 73); }
ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem; }
li { margin-bottom: 0.5rem; }

Your response should look exactly like this (but with the actual content filled in):

<h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Main Points</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Point 1</li>
  <li style="margin-bottom: 0.5rem;">Point 2</li>
</ul>

<h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Author</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Author name</li>
</ul>

<h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937;">Date</h1>
<ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem;">
  <li style="margin-bottom: 0.5rem;">Publication date</li>
</ul>

TEXT TO SUMMARIZE: ${text}
`,
    });
    
    // Clear the timeout since the request completed
    clearTimeout(timeoutId);
    
    // Calculate and log response time
    const responseTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Gemini API responded in ${responseTime}ms`);
    
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
  } catch (error: unknown) {
    // Check if this was an abort error from our timeout
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[${new Date().toISOString()}] Gemini API request timed out after ${timeoutMs}ms`);
      return `<h1 style="color: red;">Request Timeout</h1><p>The AI service took too long to respond. Please try again with a shorter text or try later.</p>`;
    }
    
    // Handle other errors
    console.error(`[${new Date().toISOString()}] Error generating summary:`, error);
    return `<h1 style="color: red;">Error Generating Summary</h1><p>The AI service encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}</p>`;
  }
}

const server = Bun.serve({
  port: 3000,
  websocket: {
    message() {}, // Empty handler
    open() {},
    close() {},
  },
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

    // Handle TTS route
    else if (url.pathname === "/api/tts" && method === "POST") {
      try {
        console.log(`[${new Date().toISOString()}] Processing TTS request`);

        // Get request body as JSON
        const requestData = await req.json();
        const text = requestData.text;
        const language = requestData.language || "en";

        if (!text) {
          console.log(
            `[${new Date().toISOString()}] Error: No text provided for TTS`
          );
          return new Response("No text provided", {
            status: 400,
            headers: corsHeaders,
          });
        }

        console.log(
          `[${new Date().toISOString()}] Generating speech for ${
            text.length
          } characters in ${language}`
        );

        // Create a Google TTS URL directly
        const ttsEngine = require("node-gtts")(language);

        // Use a custom approach to get audio data without writing to disk
        return new Promise<Response>((resolve, reject) => {
          try {
            // Create a Buffer to hold the audio data
            const chunks: Buffer[] = [];

            // Get the audio stream from node-gtts
            const audioStream = ttsEngine.stream(text);

            // Handle data events
            audioStream.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            // Handle end event
            audioStream.on("end", () => {
              // Combine all chunks into a single buffer
              const audioBuffer = Buffer.concat(chunks);
              console.log(
                `[${new Date().toISOString()}] Generated ${
                  audioBuffer.length
                } bytes of audio data`
              );

              // Convert Node.js Buffer to Uint8Array for Bun
              const audioData = new Uint8Array(audioBuffer);

              // Return the audio data
              resolve(
                new Response(audioData, {
                  headers: {
                    "Content-Type": "audio/wav",
                    "Content-Disposition": `attachment; filename="speech.wav"`,
                    ...corsHeaders,
                  },
                })
              );
            });

            // Handle error event
            audioStream.on("error", (err: Error) => {
              console.error(
                `[${new Date().toISOString()}] Error streaming TTS audio:`,
                err
              );
              reject(err);
            });
          } catch (streamError) {
            console.error(
              `[${new Date().toISOString()}] Stream setup error:`,
              streamError
            );
            reject(streamError);
          }
        }).catch((error) => {
          return new Response(
            `Error generating speech: ${(error as Error).message}`,
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        });
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Error in TTS processing:`,
          error
        );
        return new Response(
          `Error generating speech: ${(error as Error).message}`,
          {
            status: 500,
            headers: corsHeaders,
          }
        );
      }
    }

    // Handle test TTS page route
    else if (url.pathname === "/test-tts" && method === "GET") {
      console.log(`[${new Date().toISOString()}] Serving TTS test page`);
      const ttsTestFile = await Bun.file("tts-test.html").text();
      return new Response(ttsTestFile, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    }

    // Handle root route
    else if (url.pathname === "/" && method === "GET") {
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
            h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; color: #1f2937; }
            ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.5rem; }
            li { margin-bottom: 0.5rem; }
            .links { margin-top: 30px; }
            .links a { display: inline-block; margin-right: 15px; color: #4285f4; text-decoration: none; }
            .links a:hover { text-decoration: underline; }
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
          
          <div class="links">
            <a href="/test-tts" target="_blank">Text-to-Speech Tool</a>
          </div>
          
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

    // Handle 404 for any other routes
    else {
      console.log(
        `[${new Date().toISOString()}] Not Found: ${method} ${url.pathname}`
      );
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders,
      });
    }
  },
});

console.log(`Server running at http://localhost:${server.port}`);
