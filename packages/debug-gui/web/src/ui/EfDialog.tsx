import React from "react";
import { createComponent } from "@lit/react";
import { Dialog as EfDialogElement } from "@refinitiv-ui/elements/dialog";

export const EfDialog = createComponent({
    react: React,
    tagName: "ef-dialog",
    elementClass: EfDialogElement,
    events: {
        onOpenedChanged: "opened-changed",
        onConfirm: "confirm",
        onCancel: "cancel",
    },
});
