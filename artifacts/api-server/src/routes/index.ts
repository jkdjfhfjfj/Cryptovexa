import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { accounts } from "./accounts";
import { workspace } from "./workspace";
import { userActions } from "./user-actions";
import { adminActions } from "./admin-actions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accounts,workspace,userActions,adminActions);

export default router;
