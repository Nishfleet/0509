import os from "node:os";

// The hardened self-hosted verify runners cannot enumerate machine
// interfaces: the native call throws `uv_interface_addresses returned
// Unknown system error 97` (EAFNOSUPPORT). The Cloudflare Vite plugin calls
// os.networkInterfaces() through get-port while selecting its inspector port,
// killing the local release server before the first journey. This shim is a
// transparent pass-through that returns an empty interface map ONLY for that
// exact enumeration failure, letting the loopback-only server boot. Any other
// error still propagates so genuine startup failures stay loud.
const realNetworkInterfaces = os.networkInterfaces;

const wrappedNetworkInterfaces = () => {
  try {
    return realNetworkInterfaces();
  } catch (error) {
    const isInterfaceEnumerationFailure =
      error &&
      typeof error === "object" &&
      "syscall" in error &&
      error.syscall === "uv_interface_addresses";
    if (isInterfaceEnumerationFailure) return {};
    throw error;
  }
};

os.networkInterfaces = wrappedNetworkInterfaces;
