import { config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

export default wrap(async () => {
  return json(200, {
    vaultId: config.vaultId,
    vaultEnv: config.vaultEnv,
    collectJsUrl: process.env.VGS_COLLECT_JS || "https://js.verygoodvault.com/vgs-collect/4.0.0/vgs-collect.js",
  });
});
