import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.PORT, () => {
  console.log(`PayPal AI Assistant API listening on port ${config.PORT} (${config.PAYPAL_ENVIRONMENT})`);
});
