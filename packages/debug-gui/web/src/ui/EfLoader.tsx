import React from "react";
import { createComponent } from "@lit/react";
import { Loader as EfLoaderElement } from "@refinitiv-ui/elements/loader";

export const EfLoader = createComponent({
    react: React,
    tagName: "ef-loader",
    elementClass: EfLoaderElement,
});
