"use client";

import { useEffect, useRef } from "react";
import { defaultLocale, type Locale } from "./locales";

const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
const translatedAttributes = ["placeholder", "title", "aria-label", "alt"];
const translatedInputTypes = new Set(["button", "submit", "reset"]);

function hasOptOut(element: Element | null) {
  return Boolean(element?.closest("[data-no-auto-translate]"));
}

function shouldSkipElement(element: Element | null) {
  if (!element) return true;
  if (ignoredTags.has(element.tagName)) return true;
  if (hasOptOut(element)) return true;

  if (element instanceof HTMLElement) {
    if (element.isContentEditable) return true;
    if (element.closest("[contenteditable='true']")) return true;
  }

  return false;
}

function translateCoreText(input: string, translate: (text: string) => string) {
  const leading = input.match(/^\s*/)?.[0] ?? "";
  const trailing = input.match(/\s*$/)?.[0] ?? "";
  const core = input.slice(leading.length, input.length - trailing.length);

  if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) {
    return input;
  }

  const translated = translate(core);
  if (!translated || translated === core) {
    return input;
  }

  return `${leading}${translated}${trailing}`;
}

export function AutoTranslateDom({
  locale,
  translate,
}: {
  locale: Locale;
  translate: (text: string) => string;
}) {
  const textOriginalsRef = useRef(new WeakMap<Text, string>());
  const attrOriginalsRef = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    if (locale === defaultLocale || typeof document === "undefined" || !document.body) {
      return undefined;
    }

    const textOriginals = textOriginalsRef.current;
    const attrOriginals = attrOriginalsRef.current;

    const translateTextNode = (node: Text) => {
      const parent = node.parentElement;
      if (shouldSkipElement(parent)) return;

      const original = textOriginals.get(node) ?? node.nodeValue ?? "";
      if (!textOriginals.has(node)) {
        textOriginals.set(node, original);
      }

      const translated = translateCoreText(original, translate);
      if (translated !== node.nodeValue) {
        node.nodeValue = translated;
      }
    };

    const translateAttribute = (element: Element, attributeName: string) => {
      if (shouldSkipElement(element)) return;

      const currentValue = element.getAttribute(attributeName);
      if (currentValue == null) return;

      let originals = attrOriginals.get(element);
      if (!originals) {
        originals = new Map<string, string>();
        attrOriginals.set(element, originals);
      }

      const original = originals.get(attributeName) ?? currentValue;
      if (!originals.has(attributeName)) {
        originals.set(attributeName, original);
      }

      const translated = translateCoreText(original, translate);
      if (translated !== currentValue) {
        element.setAttribute(attributeName, translated);
      }
    };

    const translateInputValue = (element: Element) => {
      if (!(element instanceof HTMLInputElement)) return;
      if (!translatedInputTypes.has(element.type)) return;
      if (shouldSkipElement(element)) return;

      let originals = attrOriginals.get(element);
      if (!originals) {
        originals = new Map<string, string>();
        attrOriginals.set(element, originals);
      }

      const original = originals.get("value") ?? element.value;
      if (!originals.has("value")) {
        originals.set("value", original);
      }

      const translated = translateCoreText(original, translate);
      if (translated !== element.value) {
        element.value = translated;
      }
    };

    const translateElement = (element: Element) => {
      if (shouldSkipElement(element)) return;

      for (const attributeName of translatedAttributes) {
        translateAttribute(element, attributeName);
      }

      translateInputValue(element);
    };

    const translateTree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root as Text);
        return;
      }

      if (root.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = root as Element;
      translateElement(element);

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.currentNode;

      while (current) {
        if (current.nodeType === Node.TEXT_NODE) {
          translateTextNode(current as Text);
        } else if (current.nodeType === Node.ELEMENT_NODE) {
          translateElement(current as Element);
        }

        current = walker.nextNode();
      }
    };

    translateTree(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
          translateTextNode(mutation.target as Text);
        }

        if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
          translateElement(mutation.target as Element);
        }

        for (const node of mutation.addedNodes) {
          translateTree(node);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...translatedAttributes, "value"],
    });

    return () => observer.disconnect();
  }, [locale, translate]);

  return null;
}
