import * as React from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import heic2any from "heic2any";

// The shared RecipeBox application intentionally consumes browser globals.
// EverPlate packages those same public APIs locally so first launch and saved
// recipe browsing do not depend on third-party CDNs.
window.React = React;
window.ReactDOM = { createRoot };
window.jspdf = { jsPDF };
window.pdfjsLib = pdfjsLib;
window["pdfjs-dist/build/pdf"] = pdfjsLib;
window.heic2any = heic2any;
