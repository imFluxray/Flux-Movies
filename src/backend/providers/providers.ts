import {
  makeProviders,
  makeStandardFetcher,
  targets,
} from "@movie-web/providers";

import { isExtensionActiveCached } from "@/backend/extension/messaging";
import {
  getLoadbalancedProxyUrl,
  makeExtensionFetcher,
  makeLoadBalancedSimpleProxyFetcher,
} from "@/backend/providers/fetchers";
import {
  makeProviders as makePstreamProviders,
  makeStandardFetcher as makePstreamStandardFetcher,
  targets as pstreamTargets,
} from "@afterstream/providers";

export function getProviders() {
  if (isExtensionActiveCached()) {
    return makeProviders({
      fetcher: makeStandardFetcher(fetch),
      proxiedFetcher: makeExtensionFetcher(),
      target: targets.BROWSER_EXTENSION,
      consistentIpForRequests: true,
    });
  }

  return makeProviders({
    fetcher: makeStandardFetcher(fetch),
    proxiedFetcher: makeLoadBalancedSimpleProxyFetcher(),
    target: targets.BROWSER,
  });
}

export function getAllProviders() {
  return makeProviders({
    fetcher: makeStandardFetcher(fetch),
    target: targets.BROWSER_EXTENSION,
    consistentIpForRequests: true,
  });
}

/** Build the verified native runtime sources with all required embed helpers. */
export function getFluxNativeProviders() {
  return makeProviders({
    fetcher: makeStandardFetcher(fetch),
    proxiedFetcher: makeLoadBalancedSimpleProxyFetcher(),
    target: targets.ANY,
    consistentIpForRequests: true,
  });
}

/** Build exact sources from the newer surviving P-Stream/Afterstream fork. */
export function getFluxPstreamProviders() {
  return makePstreamProviders({
    fetcher: makePstreamStandardFetcher(fetch),
    proxiedFetcher: makeLoadBalancedSimpleProxyFetcher(),
    target: pstreamTargets.ANY,
    consistentIpForRequests: true,
  });
}

let kdesaModule: Promise<any> | null = null;
const KDESA_MODULE_URL = "/kdesa/vendor-DikADjfW.js";

/** Load the exact browser provider module currently shipped by KDesa. */
export async function getFluxKdesaProviders() {
  if (!kdesaModule) kdesaModule = import(/* @vite-ignore */ KDESA_MODULE_URL);
  const module = await kdesaModule;
  const proxy = getLoadbalancedProxyUrl();
  return module.aB({
    fetcher: module.aD(fetch),
    proxiedFetcher: proxy ? module.aj(proxy, fetch) : module.aD(fetch),
    target: module.aC.BROWSER,
    consistentIpForRequests: true,
  });
}
