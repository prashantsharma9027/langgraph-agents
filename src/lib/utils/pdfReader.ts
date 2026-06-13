import fs from "fs/promises";
import path from "path";
import pdf from "pdf-parse";

/**
 * Reads and extracts text from a PDF file located relative to the Next.js process root.
 */
export async function readPdfFile(relativeFilePath: string): Promise<string> {
  try {
    const fullPath = path.resolve(process.cwd(), relativeFilePath);
    
    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`File does not exist at path: ${fullPath}`);
    }

    const dataBuffer = await fs.readFile(fullPath);
    const data = await pdf(dataBuffer);
    
    return data.text || "";
  } catch (error) {
    console.error("PDF reading utility error:", error);
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}
