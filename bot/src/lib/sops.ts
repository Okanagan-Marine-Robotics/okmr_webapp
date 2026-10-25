// Re-exports SOP and emergency info helpers from `@okmr_webapp/shared/sops` so
// the bot works identically in a stateless Cloudflare Worker (using bundled
// SOPs) and in local Node dev (reading `web/sops/*.txt` and `web/emergency.txt`).

export {
  BUNDLED_EMERGENCY_INFO,
  BUNDLED_SOPS,
  listSops,
  readEmergencyInfo,
  readSop,
  sopTitle,
} from "@okmr_webapp/shared/sops";
