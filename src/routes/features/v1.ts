import { Router, type NextFunction } from "express";
import { autho } from "../../middlewares/auth.js";
import  jwt from "jsonwebtoken";
import { analyzeResume } from "../../utils/ai-analyzer.js";
import { extractText } from "../../utils/extractText.js";
import multer from "multer"
import {client} from "../../db/databs.js"
import "dotenv/config"


export const featureRouter=Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})




featureRouter.get("/dashboard",autho,async (req,res)=>{
    const user=await client.user.findUnique({
           //@ts-ignore
        where:{id:req.userId}});
    if(!user) res.status(401).json({
        message:"you are not a user in db"
    })
    res.status(201).json({
        message:"you are logged in",
        name:user?.name
    })
    
})

featureRouter.get("/token",(req,res,next:NextFunction)=>{
     try{
    const token = req.headers.authorization?.split(" ")[1];
    if(!token){
        res.status(400).json({
            message:"no token"
        })
    }
   
    const decoded = jwt.verify(token!, process.env.JWTSECRET!);
    if(!decoded){
        res.status(402).json({
            message:"dont to this token thingy "
        })
    }
   //@ts-ignore
    res.status(201).json({
        message:"token is verified"
    });
    }catch(err){
        console.log(err);
        res.status(403).json({
            message:"invalid or no token"
        })
    }
})


featureRouter.post("/analyze-resume",upload.single("resume"),async (req,res)=>{
    try {
        const file = req.file;
        const jobDescription = req.body.jobDescription || "";
        if(!file)  {res.status(401).json({
            message:"file wasnt provided "
        });
        return ;
    }
        const text = await extractText(file);

        const result= await analyzeResume(text!,jobDescription);
        console.log(result);

     res.status(201).json({
        message:result
    })
    
    } catch (error) {
        console.log(error);
        res.status(401).json({
            message:"resume parsing failed :( "
        })
    }
    
});


featureRouter.post("/scam-reports",async(req,res)=>{

    const {token}=req.body;
     const decodeduser = jwt.verify(token, process.env.JWTSECRET!);
    try {
        const reports = await client.scamReport.findMany({
  include: {
    user: {
      select: {
        name: true
      }
    },
    votes: {
      where: {
          //@ts-ignore
        userId: decodeduser.userId 
      },
      select: {
        voteType: true
      }
    }
  }
});
const formattedReports = reports.map(report => ({
  id: report.id,
  title: report.title,
  description:report.description,
  userName: report.user.name,
  upvotes: report.upvotes,
  downvotes: report.downvotes,

  user_vote: report.votes[0]?.voteType || null,
  createdAt:report.createdAt
}));
        
            res.json({
                 formattedReports
            })
    } catch (error) {
        console.log(error)
    }
    
})

featureRouter.post("/vote",async(req,res)=>{
   
const { reportId, token, voteType } = req.body;

const decodedUser: any = jwt.verify(token, process.env.JWTSECRET!);
const userId = decodedUser.userId;
console.log("voting started")
try {
  await client.$transaction(async (tx) => {

    //  Check existing vote
    const existingVote = await tx.reportVote.findUnique({
      where: {
        userId_reportId: {
          userId,
          reportId,
        },
      },
    });

    // Case: No existing vote → CREATE
    if (!existingVote) {
      await tx.reportVote.create({
        data: {
          userId,
          reportId,
          voteType,
        },
      });

      const updateData: any = {};

if (voteType === 'UPVOTE') {
  updateData.upvotes = { increment: 1 };
}

if (voteType === 'DOWNVOTE') {
  updateData.downvotes = { increment: 1 };
}

await tx.scamReport.update({
  where: { id: reportId },
  data: updateData,
});
      

      return;
    }

    //  Case: Same vote → REMOVE (toggle off)
    if (existingVote.voteType === voteType) {
      await tx.reportVote.delete({
        where: {
          userId_reportId: {
            userId,
            reportId,
          },
        },
      });

      const updateData: any = {};

if (voteType === 'UPVOTE') {
  updateData.upvotes = { decrement: 1 };
}

if (voteType === 'DOWNVOTE') {
  updateData.downvotes = { decrement: 1 };
}

await tx.scamReport.update({
  where: { id: reportId },
  data: updateData,
});

      

      return;
    }

    //  Case: Switch vote
    await tx.reportVote.update({
      where: {
        userId_reportId: {
          userId,
          reportId,
        },
      },
      data: {
        voteType,
      },
    });

    await tx.scamReport.update({
      where: { id: reportId },
      data: {
        upvotes:
          voteType === 'UPVOTE'
            ? { increment: 1 }
            : { decrement: 1 },

        downvotes:
          voteType === 'DOWNVOTE'
            ? { increment: 1 }
            : { decrement: 1 },
      },
    });

  });
console.log("voting ended")

  res.json({ success: true });

} catch (err) {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}
   

})

featureRouter.post("/create-report",async(req,res)=>{
   

    const {formData,token}=req.body;
    const decodeduser = jwt.verify(token, process.env.JWTSECRET!);


   try {
     const dbinsert=await client.scamReport.create({
        data:{
            title:formData.title,
            companyName:formData.companyName,
            description:formData.description,
            scamPlatform:formData.scamPlatform,
            contactInfo:formData.scammerContact,
            evidenceUrl:formData.evidenceUrl,
             //@ts-ignore
            userId:decodeduser.userId
        }
    });

    res.status(201).json({
        messae:"report created successfully "
    });

    
   } catch (error) {
    res.status(402).json({
        message:"some error while reporting "
    })
   }
   



})


