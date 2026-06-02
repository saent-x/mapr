export default {
  providers: [
    {
      // Self-hosted: CONVEX_SITE_URL is the deployment's HTTP-actions origin
      // (the 3211 proxy locally; the tunnel origin in prod).
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
