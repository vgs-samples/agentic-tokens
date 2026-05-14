import { getAccessToken } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

export default wrap(async () => {
  const token = await getAccessToken();
  return json(200, { access_token: token });
});
