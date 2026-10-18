import { Router, type IRouter } from "express";
import arenaRouter from "./arena";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(arenaRouter);

export default router;
