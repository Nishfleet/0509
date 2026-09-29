import { rolloverInstance } from "../app/lib/brief-schedule";
import { rolloverInstance as inst } from "../app/lib/brief-schedule";

declare const ws: string;
declare const due: Date;

// ruleid: rollover-catch-up-call-site
const bad = rolloverInstance(ws, due, "catch-up");

// ruleid: rollover-catch-up-call-site
const badAlias = inst(ws, due, "catch-up");

// ok: rollover-catch-up-call-site
const good = rolloverInstance(ws, due, "scheduled");
