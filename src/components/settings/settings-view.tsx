"use client";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { BrandingForm } from "./branding-form";
import { TeamPanel } from "./team-panel";

export function SettingsView() {
  const [tabValue, setTabValue] = useState("brand");
  const tab = "rounded-md px-4 py-1.5 text-sm data-[state=active]:bg-white data-[state=active]:font-medium data-[state=active]:shadow-sm";
  return (
    <div className="space-y-4 p-6">
      <Tabs.Root value={tabValue} onValueChange={setTabValue}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Configurações</h1>
          <Tabs.List className="flex flex-wrap rounded-lg bg-slate-100 p-1">
            <Tabs.Trigger value="brand" className={tab}>Marca (White-Label)</Tabs.Trigger>
            <Tabs.Trigger value="team" className={tab}>Equipe</Tabs.Trigger>
          </Tabs.List>
        </div>
        <Tabs.Content value="brand" className="mt-4"><BrandingForm /></Tabs.Content>
        <Tabs.Content value="team" className="mt-4"><TeamPanel /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
