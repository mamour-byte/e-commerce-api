
const ngrok = require("@ngrok/ngrok");

async function main() {
  const listener = await ngrok.forward({
    addr: "127.0.0.1:3000",
    authtoken_from_env: true,
  });

  const url = listener.url();

  console.log("\nTunnel HTTPS actif :", url);
  console.log(
    "Webhook Bictorys :",
    `${url}/api/payments/webhooks/bictorys`,
    );
  console.log(
    "Redirection retour :",
    `${url}/api/payments/redirect/success`,
    );
  console.log(
    "  -> reporter cette URL dans API_PUBLIC_URL du .env (coté API)",
    );
  console.log("\nAppuie sur Ctrl+C pour arrêter le tunnel.\n");

  process.stdin.resume();

  process.on("SIGINT", async () => {
    console.log("\nFermeture du tunnel...");
    await listener.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Erreur ngrok :", error);
  process.exitCode = 1;
});
