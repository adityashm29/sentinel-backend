import { Router } from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { autho } from '../../middlewares/auth.js';
const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
router.post('/scan', autho, upload.array('images', 5), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No profile images uploaded' });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const prompt = `
      You are an expert career coach, recruiter, and personal branding specialist. 
      Review the provided screenshots of a user's LinkedIn or professional social media profile.
      Analyze the profile's strength, visibility, and professionalism across all provided images.
      
      Return the output EXACTLY as a JSON object (no markdown formatting like \`\`\`json, just the raw JSON object) with the following strictly typed structure:
      {
        "overallScore": number (out of 100),
        "summary": "string (Brief 2-3 sentence overview of their current profile presence)",
        "strengths": ["string (array of strong points recognized)"],
        "weaknesses": ["string (array of areas lacking or omitted)"],
        "actionableTips": ["string (array of specific, actionable recommendations to improve the profile visibility and attract quality opportunities)"]
      }
    `;
        const imageParts = files.map(file => ({
            inlineData: {
                data: file.buffer.toString("base64"),
                mimeType: file.mimetype
            }
        }));
        const result = await model.generateContent([prompt, ...imageParts]);
        let rawText = result.response.text().trim();
        if (rawText.startsWith('\`\`\`json'))
            rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        if (rawText.startsWith('\`\`\`'))
            rawText = rawText.replace(/\`\`\`/g, '').trim();
        const analysis = JSON.parse(rawText);
        res.json(analysis);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
export default router;
