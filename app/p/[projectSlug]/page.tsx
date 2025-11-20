"use client";

import { MainApp } from "../../page";

export default function ProjectPage() {
  // In this older architecture there is no "project" primary view type.
  // Projects are handled inside the chat experience itself.
  return <MainApp initialPrimaryView="chat" />;
}
