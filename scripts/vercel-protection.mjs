const VERCEL_HOST_SUFFIX = ".vercel.app";
const VERCEL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const DEPLOYMENT_ID_PATTERN = /^[a-z0-9]+$/;

export function buildProtectionBypassHeaders(baseUrl, environment = process.env) {
  const secret = environment.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (secret === undefined || secret === "") return undefined;

  const projectSlug = parseVercelSlug(environment.VERCEL_AUTOMATION_BYPASS_PROJECT_SLUG);
  const teamSlug = parseVercelSlug(environment.VERCEL_AUTOMATION_BYPASS_TEAM_SLUG);
  if (projectSlug === undefined || teamSlug === undefined) return undefined;

  if (!isTrustedVercelDeployment(baseUrl, projectSlug, teamSlug)) return undefined;
  return { "x-vercel-protection-bypass": secret };
}

export function isTrustedVercelDeployment(baseUrl, projectSlug, teamSlug) {
  if (baseUrl.protocol !== "https:") return false;

  const hostname = baseUrl.hostname.toLowerCase();
  const prefix = `${projectSlug}-`;
  const suffix = `-${teamSlug}${VERCEL_HOST_SUFFIX}`;
  if (!hostname.startsWith(prefix) || !hostname.endsWith(suffix)) return false;

  const deploymentId = hostname.slice(prefix.length, -suffix.length);
  return DEPLOYMENT_ID_PATTERN.test(deploymentId);
}

function parseVercelSlug(value) {
  if (value === undefined || value === "") return undefined;
  const normalized = value.toLowerCase();
  return VERCEL_SLUG_PATTERN.test(normalized) ? normalized : undefined;
}
