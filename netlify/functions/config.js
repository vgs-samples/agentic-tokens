import { config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

export default wrap(async () => {
  return json(200, { vaultId: config.vaultId, vaultEnv: config.vaultEnv });
});
