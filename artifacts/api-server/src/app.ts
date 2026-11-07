import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { AppError } from "./lib/platform";

const app: Express = express();
app.set("trust proxy",1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:"same-origin"}}));
app.use(cookieParser());
app.use(express.json({limit:"512kb"}));
app.use(express.urlencoded({ extended: true }));
app.use("/api",rateLimit({windowMs:60000,limit:240,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many requests. Please wait a minute."}}));
app.use(["/api/v1/auth","/api/admin/auth"],rateLimit({windowMs:15*60000,limit:30,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many account attempts. Please wait 15 minutes."}}));
app.use(["/api/v1/actions","/api/admin/actions"],rateLimit({windowMs:60000,limit:40,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many actions. Please wait a minute."}}));
app.use("/api",(req,res,next)=>{
  res.set("Cache-Control","no-store");
  if(["GET","HEAD","OPTIONS"].includes(req.method)){next();return;}
  if(process.env.LOCAL_OBJECT_STORAGE_DIR&&req.method==="PUT"&&/^\/v1\/uploads\/local\/[0-9a-f-]{36}$/i.test(req.path)){next();return;}
  const a=req.cookies?.vexa_csrf,b=req.get("x-csrf-token");
  if(typeof a!=="string"||typeof b!=="string"||Buffer.byteLength(a)!==Buffer.byteLength(b)||!timingSafeEqual(Buffer.from(a),Buffer.from(b))){
    res.status(403).json({error:"Security token expired. Reload the page and try again."});return;
  }
  const origin=req.get("origin");
  if(origin){
    const allowed=[req.get("host"),req.get("x-forwarded-host"),process.env.REPLIT_DEV_DOMAIN].filter(Boolean);
    try{if(!allowed.includes(new URL(origin).host)){res.status(403).json({error:"Cross-origin action blocked"});return;}}
    catch{res.status(403).json({error:"Invalid request origin"});return;}
  }
  next();
});

app.use("/api", router);
const errorHandler:ErrorRequestHandler=(err,req,res,_next)=>{
  if(err instanceof AppError){res.status(err.status).json({error:err.message});return;}
  if(err instanceof ZodError){res.status(400).json({error:err.issues.map(i=>i.message).join(". ")});return;}
  if(err?.code==="23505"){res.status(409).json({error:"This record already exists. Transaction IDs can only be submitted once."});return;}
  if(err?.code==="23503"){res.status(400).json({error:"Related account or record not found."});return;}
  req.log.error({name:err?.name,code:err?.code},"Request failed");
  res.status(500).json({error:"The request could not be completed. Please try again or contact support."});
};
app.use(errorHandler);

export default app;
