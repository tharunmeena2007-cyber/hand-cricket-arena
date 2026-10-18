import { Router, type IRouter } from "express";
import { GetArenaStatusResponse } from "@workspace/api-zod";
import { getArenaStatus } from "../game/engine";

const router: IRouter = Router();

router.get("/arena/status", (_req, res) => {
  res.json(GetArenaStatusResponse.parse(getArenaStatus()));
});

export default router;
