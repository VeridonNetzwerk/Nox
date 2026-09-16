import { useState, useCallback } from "react";
import { LOCALE_MAP } from "../../../shared/constants.jsx";
import deLocale from "../../../locales/de.json";

export function useLocale() {
  const [localeData, setLocaleData] = useState(deLocale);

  const applyLocale = useCallback(async (langCode) => {
    const loader = LOCALE_MAP[langCode];
    if (loader) {
      const mod = await loader();
      setLocaleData(mod.default);
    }
  }, []);

  return { localeData, setLocaleData, applyLocale };
}
