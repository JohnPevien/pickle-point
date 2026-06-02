const clientId = process.env.WORKOS_CLIENT_ID;
const disableAuth = process.env.CONVEX_AUTH_DISABLE === "true";

if (!disableAuth && !clientId) {
  throw new Error(
    "WORKOS_CLIENT_ID environment variable is required for Convex auth configuration. " +
    "Set CONVEX_AUTH_DISABLE=true to intentionally disable auth in development.",
  );
}

const authConfig = {
  providers: clientId
    ? [
        {
          domain: "https://api.workos.com",
          applicationID: clientId,
        },
        {
          domain: `https://api.workos.com/user_management/${clientId}`,
          applicationID: clientId,
        },
      ]
    : [],
};

export default authConfig;
