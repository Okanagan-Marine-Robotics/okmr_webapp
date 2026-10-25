// Shared SOPs and emergency info.
// Bundled in-memory so Cloudflare Workers (which have no access to web/sops/ on
// a local disk) can serve /sop and /911 with zero filesystem dependency, while
// still checking web/sops/ dynamically when running on local Node.js.

export const BUNDLED_SOPS: Record<string, string> = {
  EDT_Space: `EDT Space
===========

Blah blah

Before you start
----------------
1. Confirm the hull interior is dry and free of tools.
2. Check the O-ring seat for grit, hair and nicks.
3. Have the torque wrench signed out (/chkout torque wrench).

Procedure
---------
1. Seat the O-ring evenly, no twists.
2. Fit the end cap by hand until flush.
3. Tighten bolts in a star pattern, in two passes.
4. Torque to spec on the final pass.
5. Record the torque value in the build log.

Before you sign off
-------------------
- Pressure test to the depth listed in the test plan.
- Photograph the closed joint for the build log.
- Return the torque wrench (/chkin torque wrench).

If anything does not match this document, stop and ask a lead. Do not improvise
on a pressure boundary.
`,
  sub_closure: `Sub Closure
===========

EXAMPLE FILE — replace this with the real procedure.

Any .txt file you drop in this folder becomes a SOP automatically. The file name
is the name you type: this file is sub_closure.txt, so it is /sop sub_closure.
Use lowercase letters, numbers and underscores in file names.

Before you start
----------------
1. Confirm the hull interior is dry and free of tools.
2. Check the O-ring seat for grit, hair and nicks.
3. Have the torque wrench signed out (/chkout torque wrench).

Procedure
---------
1. Seat the O-ring evenly, no twists.
2. Fit the end cap by hand until flush.
3. Tighten bolts in a star pattern, in two passes.
4. Torque to spec on the final pass.
5. Record the torque value in the build log.

Before you sign off
-------------------
- Pressure test to the depth listed in the test plan.
- Photograph the closed joint for the build log.
- Return the torque wrench (/chkin torque wrench).

If anything does not match this document, stop and ask a lead. Do not improvise
on a pressure boundary.
`,
};

export const BUNDLED_EMERGENCY_INFO = `EMERGENCY INFORMATION
=====================

TEMPLATE — replace everything below with your club's real details before anyone
relies on this. /911 prints this file as-is.

If someone is seriously hurt, call emergency services FIRST. Do not wait for a
lead, and do not use this bot as the way to summon help.

Emergency services: <your local emergency number>
Campus security:    <number>
EDT front desk:     <number>

Club contacts
-------------
Safety lead:        <name> — <phone>
Faculty advisor:    <name> — <phone>
Shop supervisor:    <name> — <phone>

First aid
---------
Kit location:       <where>
Eyewash station:    <where>
Fire extinguisher:  <where>
Nearest AED:        <where>

Immediate actions
-----------------
1. Make the area safe — cut power at the disconnect if it is electrical.
2. Call for help. Say the building, floor and room number.
3. Send someone to the entrance to meet responders.
4. Do not move an injured person unless they are in further danger.
5. Once everyone is safe, notify the safety lead and faculty advisor.

Specific hazards
----------------
Battery fire / thermal runaway: <procedure>
Pressure vessel failure:        <procedure>
Chemical spill:                 <procedure>

After any incident, however minor, tell a lead the same day so it gets recorded.
`;

// A SOP name becomes a filename/key, so it must only contain safe characters.
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

// "sub_closure" -> "Sub Closure"
export function sopTitle(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isCloudflareWorkers(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    ("WebSocketPair" in globalThis ||
      (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers"))
  );
}

export async function listSops(): Promise<string[]> {
  const names = new Set<string>(Object.keys(BUNDLED_SOPS));

  if (!isCloudflareWorkers()) {
    try {
      const [{ readdir }, { dirname, resolve }, { fileURLToPath }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
      ]);
      const here = dirname(fileURLToPath(import.meta.url));
      const sopDir = resolve(here, "../../../web/sops");
      const files = await readdir(sopDir);
      for (const f of files) {
        if (f.toLowerCase().endsWith(".txt")) {
          const name = f.slice(0, -4);
          if (SAFE_NAME.test(name)) names.add(name);
        }
      }
    } catch {
      // Running in an environment without web/sops on disk — bundled SOPs are used.
    }
  }

  return [...names].sort();
}

export async function readSop(name: string): Promise<string | null> {
  if (!SAFE_NAME.test(name)) return null;

  if (!isCloudflareWorkers()) {
    try {
      const [{ readFile }, { dirname, join, resolve }, { fileURLToPath }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
      ]);
      const here = dirname(fileURLToPath(import.meta.url));
      const sopDir = resolve(here, "../../../web/sops");
      return await readFile(join(sopDir, `${name}.txt`), "utf8");
    } catch {
      // Fall back to bundled SOP map below.
    }
  }

  return BUNDLED_SOPS[name] ?? null;
}

export async function readEmergencyInfo(): Promise<string | null> {
  if (!isCloudflareWorkers()) {
    try {
      const [{ readFile }, { dirname, resolve }, { fileURLToPath }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
      ]);
      const here = dirname(fileURLToPath(import.meta.url));
      const emergencyFile = resolve(here, "../../../web/emergency.txt");
      return await readFile(emergencyFile, "utf8");
    } catch {
      // Fall back to bundled emergency text below.
    }
  }

  return BUNDLED_EMERGENCY_INFO;
}
