"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";
import { Loader2, Save, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getSystemSettingsAction, saveSystemSettingAction } from "@/actions/system-settings";
import { FeatureFlagsConfigSchema, type FeatureFlagsConfig } from "@/lib/feature-flags/schema";

const EMPTY_CONFIG: FeatureFlagsConfig = {
  version: 1,
  defaults: {
    enabled: false,
    releaseChannels: ["stable"],
  },
  flags: {},
};

const SAMPLE_CONFIG: FeatureFlagsConfig = {
  version: 1,
  defaults: {
    enabled: false,
    releaseChannels: ["stable", "canary"],
  },
  flags: {
    new_inbox_ui: {
      enabled: true,
      rollout: 10,
      releaseChannels: ["canary"],
      description: "New inbox UI rollout",
    },
    ai_smart_reply: {
      enabled: true,
      rollout: 50,
      users: ["user-id-1", "user-id-2"],
      description: "AI smart reply for internal testers",
    },
  },
};

const formatJson = (config: FeatureFlagsConfig) => JSON.stringify(config, null, 2);

const parseConfig = (value: string) => {
  try {
    const parsedJson = JSON.parse(value);
    return FeatureFlagsConfigSchema.safeParse(parsedJson);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error : new Error("Invalid JSON"),
    };
  }
};

export default function FeatureFlagsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rawConfig, setRawConfig] = useState(formatJson(EMPTY_CONFIG));

  useEffect(() => {
    getSystemSettingsAction(["feature_flags"])
      .then((settings) => {
        const raw = settings.feature_flags;
        if (raw && raw.trim()) {
          setRawConfig(raw);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const parsed = useMemo(() => {
    if (!rawConfig.trim()) {
      return { success: false as const, error: new Error("Empty config") };
    }
    return parseConfig(rawConfig);
  }, [rawConfig]);

  const previewConfig = parsed.success ? parsed.data : null;
  const errorMessage =
    parsed.success ? "" : parsed.error instanceof Error ? parsed.error.message : "Unknown error";

  const handleSave = async () => {
    if (!parsed.success) {
      toast({
        title: "Invalid config",
        description: "Fix the JSON errors before saving.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await saveSystemSettingAction("feature_flags", formatJson(parsed.data));
      toast({
        title: "Saved",
        description: "Feature flags updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: "Could not persist feature flags.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = () => {
    if (!parsed.success) {
      return;
    }
    setRawConfig(formatJson(parsed.data));
  };

  const handleLoadSample = () => {
    setRawConfig(formatJson(SAMPLE_CONFIG));
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Feature Flags</h1>
        <p className="text-sm text-muted-foreground">
          Manage rollouts, canary cohorts, and release channels from a single config.
        </p>
      </header>

      <Card className="border border-border/60">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Config Editor
          </CardTitle>
          <CardDescription>
            Stored in system_settings under <code>feature_flags</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={rawConfig}
            onChange={(event) => setRawConfig(event.target.value)}
            rows={18}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {previewConfig ? (
              <>
                <Badge variant="secondary">Valid JSON</Badge>
                <span>{Object.keys(previewConfig.flags || {}).length} flags</span>
              </>
            ) : (
              <>
                <Badge variant="destructive">Invalid JSON</Badge>
                <span>{errorMessage}</span>
              </>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleFormat} disabled={!previewConfig}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Format JSON
            </Button>
            <Button variant="outline" onClick={handleLoadSample}>
              <Sparkles className="w-4 h-4 mr-2" />
              Load Sample
            </Button>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Config
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>High-level view of the current flags.</CardDescription>
        </CardHeader>
        <CardContent>
          {!previewConfig ? (
            <div className="text-sm text-muted-foreground">
              Fix the JSON to preview the rollout matrix.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Defaults</Badge>
                <span>enabled: {String(previewConfig.defaults?.enabled ?? false)}</span>
                <span>rollout: {previewConfig.defaults?.rollout ?? "not set"}</span>
                <span>
                  channels: {(previewConfig.defaults?.releaseChannels || ["stable"]).join(", ")}
                </span>
              </div>

              <Separator />

              {Object.keys(previewConfig.flags || {}).length === 0 ? (
                <div className="text-sm text-muted-foreground">No flags configured yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flag</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rollout</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Targets</TableHead>
                      <TableHead>Window</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(previewConfig.flags).map(([flag, definition]) => {
                      const effectiveEnabled =
                        definition.enabled ?? previewConfig.defaults?.enabled ?? false;
                      const rollout = definition.rollout ?? previewConfig.defaults?.rollout;
                      const rolloutLabel = typeof rollout === "number" ? `${rollout}%` : "-";
                      const channels =
                        definition.releaseChannels ??
                        previewConfig.defaults?.releaseChannels ??
                        ["stable"];
                      const targets = [
                        definition.users?.length ? `${definition.users.length} users` : null,
                        definition.workspaces?.length
                          ? `${definition.workspaces.length} workspaces`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" / ");
                      const window = [definition.startAt, definition.endAt].filter(Boolean).join(" -> ");

                      return (
                        <TableRow key={flag}>
                          <TableCell className="font-mono text-xs">{flag}</TableCell>
                          <TableCell>
                            <Badge variant={effectiveEnabled ? "default" : "secondary"}>
                              {effectiveEnabled ? "enabled" : "disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell>{rolloutLabel}</TableCell>
                          <TableCell className="text-xs">{channels.join(", ")}</TableCell>
                          <TableCell className="text-xs">{targets || "-"}</TableCell>
                          <TableCell className="text-xs">{window || "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
