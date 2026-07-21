import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Dialog } from "@capacitor/dialog";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { Style, StatusBar } from "@capacitor/status-bar";

const isNative = Capacitor.isNativePlatform();
const impactStyles = { light:ImpactStyle.Light, medium:ImpactStyle.Medium, heavy:ImpactStyle.Heavy };

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read shared file."));
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.readAsDataURL(blob);
  });
}

async function routeDeepLink(rawUrl) {
  try {
    const incoming = new URL(rawUrl);
    const allowedWebHost = "recipebox-kappa.vercel.app";
    const isCustom = incoming.protocol === "everplate:";
    const isKnownWeb = incoming.protocol === "https:" && incoming.hostname === allowedWebHost;
    if (!isCustom && !isKnownWeb) return false;

    const action = isCustom ? incoming.hostname : incoming.pathname.replace(/^\//, "").split("/")[0];
    const output = new URLSearchParams();
    ["reset", "verify", "url", "text", "title"].forEach((key) => {
      const value = incoming.searchParams.get(key);
      if (value) output.set(key, value);
    });
    if ((action === "reset" || action === "verify") && !output.has(action)) {
      const token = incoming.searchParams.get("token");
      if (token) output.set(action, token);
    }
    if (!output.size) return false;
    window.location.assign("/?" + output.toString());
    return true;
  } catch {
    return false;
  }
}

const bridge = {
  isNative,
  platform:Capacitor.getPlatform(),
  alert:({ title="EverPlate", message="" }) => isNative ? Dialog.alert({ title, message }) : Promise.resolve(window.alert(message)),
  async confirm({ title="EverPlate", message="" }) {
    if (!isNative) return window.confirm(message);
    return (await Dialog.confirm({ title, message, okButtonTitle:"Continue", cancelButtonTitle:"Cancel" })).value;
  },
  async shareText({ title="EverPlate", text="" }) {
    if (!isNative) return false;
    const availability = await Share.canShare();
    if (!availability.value) return false;
    await Share.share({ title, text, dialogTitle:"Share from EverPlate" });
    return true;
  },
  async shareBlob({ title="EverPlate", text="", filename="everplate.pdf", blob }) {
    if (!isNative) return false;
    const safeName = String(filename).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "everplate.pdf";
    const data = await blobToBase64(blob);
    const saved = await Filesystem.writeFile({ path:"share/" + safeName, data, directory:Directory.Cache, recursive:true });
    await Share.share({ title, text, files:[saved.uri], dialogTitle:"Share from EverPlate" });
    return true;
  },
  haptic:({ style="light" }={}) => isNative ? Haptics.impact({ style:impactStyles[style] || ImpactStyle.Light }) : Promise.resolve(),
  exitApp:() => Capacitor.getPlatform() === "android" ? App.exitApp() : Promise.resolve(),
};

window.EverPlateNative = bridge;

async function initialize() {
  if (!isNative) return;

  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  await StatusBar.setOverlaysWebView({ overlay:true }).catch(() => {});
  await StatusBar.setStyle({ style:Style.Light }).catch(() => {});
  if (Capacitor.getPlatform() === "android") await StatusBar.setBackgroundColor({ color:dark ? "#0F1412" : "#274233" }).catch(() => {});

  const updateNetwork = ({ connected, connectionType }) => {
    document.body.dataset.network = connected ? connectionType : "offline";
    window.dispatchEvent(new Event(connected ? "online" : "offline"));
  };
  updateNetwork(await Network.getStatus());
  await Network.addListener("networkStatusChange", updateNetwork);

  await Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => {
    document.documentElement.style.setProperty("--native-keyboard-height", keyboardHeight + "px");
    document.body.classList.add("native-keyboard-open");
  });
  await Keyboard.addListener("keyboardWillHide", () => {
    document.documentElement.style.removeProperty("--native-keyboard-height");
    document.body.classList.remove("native-keyboard-open");
  });

  await App.addListener("backButton", () => dispatch("everplate:native-back"));
  await App.addListener("appStateChange", ({ isActive }) => { if (isActive) dispatch("everplate:native-resume"); });
  await App.addListener("appUrlOpen", ({ url }) => { void routeDeepLink(url); });
  const launch = await App.getLaunchUrl();
  if (launch?.url) await routeDeepLink(launch.url);

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || link.target !== "_blank") return;
    const url = new URL(link.href, window.location.href);
    if (!/^https?:$/.test(url.protocol)) return;
    event.preventDefault();
    void Browser.open({ url:url.href, presentationStyle:"popover" });
  });

  window.addEventListener("load", () => { void SplashScreen.hide(); }, { once:true });
}

void initialize();
