import { Router } from 'express';
import multer from 'multer';
import { client } from "../../db/databs.js";
import { GoogleGenerativeAI } from '@google/generative-ai';
import { autho } from '../../middlewares/auth.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
router.post('/create', autho, async (req, res) => {
    try {
        const { resumeText, jobDescription } = req.body;
        // @ts-ignore
        const userId = req.userId;
        if (!resumeText || !jobDescription) {
            return res.status(400).json({ error: 'Missing resumeText or jobDescription' });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const prompt = `
      You are an expert technical interviewer. Create 10 interview questions based on the candidate's resume and the job description.
      Output ONLY a JSON array of objects with 'question' and 'category' (e.g., 'technical', 'behavioral', 'experience'). Do not add markdown blocks like \`\`\`json.
      
      Resume:
      ${resumeText}
      
      Job Description:
      ${jobDescription}
    `;
        const result = await model.generateContent(prompt);
        let rawText = result.response.text().trim();
        if (rawText.startsWith('```json'))
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        if (rawText.startsWith('```'))
            rawText = rawText.replace(/```/g, '').trim();
        const questions = JSON.parse(rawText);
        const session = await client.interviewSession.create({
            data: {
                userId,
                resumeText,
                jobDescription,
                questions: {
                    create: questions.map((q, index) => ({
                        question: q.question,
                        category: q.category,
                        order: index + 1
                    }))
                }
            },
            include: { questions: true }
        });
        res.json(session);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
router.get('/history', autho, async (req, res) => {
    try {
        // @ts-ignore
        const userId = req.userId;
        const sessions = await client.interviewSession.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                jobDescription: true,
                overallScore: true,
                createdAt: true
            }
        });
        res.json(sessions);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/:sessionId/questions', autho, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await client.interviewSession.findUnique({
            //@ts-ignore
            where: { id: sessionId },
            include: {
                questions: {
                    orderBy: { order: 'asc' },
                    include: { answer: true }
                }
            }
        });
        if (!session)
            return res.status(404).json({ error: 'Session not found' });
        res.json(session);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/:questionId/answer', autho, upload.single('audio'), async (req, res) => {
    try {
        const { questionId } = req.params;
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }
        const question = await client.interviewQuestion.findUnique({
            //@ts-ignore
            where: { id: questionId },
            include: { session: true }
        });
        if (!question)
            return res.status(404).json({ error: 'Question not found' });
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const prompt = `
      You are an expert interviewer. Below is an audio recording of a candidate answering a question, along with the question context, the job description, and the candidate's resume.
      Provide a comprehensive JSON evaluation. DO NOT add any markdown formatting (no \`\`\`json blocks).
      Extract the transcript from the audio. Then evaluate.
      
      Output JSON Format exactly:
      {
        "transcript": "string (the exact words spoken)",
        "score": number (out of 10),
        "feedback": "string (detailed feedback on the answer)",
        "fillerWordCount": number (count of umm, ahh, like, etc.),
        "strengths": "string (bullet points or paragraph)",
        "improvements": "string (what to do better)"
      }

      Context Question: ${question.question}
         
    
      Job Description: ${question.session.jobDescription.substring(0, 1000)}
      Resume: ${question.session.resumeText.substring(0, 1000)}
    `;
        const audioData = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype // e.g., 'audio/webm' or 'audio/wav'
            }
        };
        const result = await model.generateContent([prompt, audioData]);
        let rawText = result.response.text().trim();
        if (rawText.startsWith('\`\`\`json'))
            rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        if (rawText.startsWith('\`\`\`'))
            rawText = rawText.replace(/\`\`\`/g, '').trim();
        const evaluation = JSON.parse(rawText);
        const answer = await client.interviewAnswer.create({
            data: {
                //@ts-ignore
                questionId,
                transcript: evaluation.transcript,
                score: evaluation.score,
                feedback: evaluation.feedback,
                fillerWordCount: evaluation.fillerWordCount,
                strengths: evaluation.strengths,
                improvements: evaluation.improvements
            }
        });
        res.json(answer);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
router.get('/:sessionId/report', autho, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await client.interviewSession.findUnique({
            //@ts-ignore
            where: { id: sessionId },
            include: {
                questions: {
                    include: { answer: true }
                }
            }
        });
        if (!session)
            return res.status(404).json({ error: 'Session not found' });
        let totalScore = 0;
        let totalQuestions = 0;
        //@ts-ignore
        session.questions.forEach(q => {
            if (q.answer && q.answer.score) {
                totalScore += q.answer.score;
                totalQuestions++;
            }
        });
        const overallScore = totalQuestions > 0 ? totalScore / totalQuestions : 0;
        if (overallScore > 0) {
            await client.interviewSession.update({
                //@ts-ignore
                where: { id: sessionId },
                data: { overallScore }
            });
        }
        res.json({ ...session, overallScore });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
