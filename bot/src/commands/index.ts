import type { Command } from "../types.js";
import { help } from "./help.js";
import { task } from "./task.js";
import { lstask } from "./lstask.js";
import { mdtask } from "./mdtask.js";
import { cltask } from "./cltask.js";
import { config } from "./config.js";
import { meet } from "./meet.js";
import { lsmeet } from "./lsmeet.js";
import { mdmeet } from "./mdmeet.js";
import { clmeet } from "./clmeet.js";
import { form } from "./form.js";
import { lsforms } from "./lsforms.js";
import { lsalforms } from "./lsalforms.js";
import { chkout } from "./chkout.js";
import { chkin } from "./chkin.js";
import { sop } from "./sop.js";
import { emergency } from "./emergency.js";
import { devlog } from "./devlog.js";
import { progupdate } from "./progupdate.js";
import { lslogs } from "./lslogs.js";
import { resync } from "./resync.js";

export const commands: Command[] = [
  help,
  task,
  lstask,
  mdtask,
  cltask,
  config,
  meet,
  lsmeet,
  mdmeet,
  clmeet,
  form,
  lsforms,
  lsalforms,
  chkout,
  chkin,
  sop,
  emergency,
  devlog,
  progupdate,
  lslogs,
  resync,
];

export const commandsByName = new Map<string, Command>(
  commands.map((c) => [c.data.name, c]),
);
