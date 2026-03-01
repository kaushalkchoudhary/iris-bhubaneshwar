import { useState, useEffect } from 'react';
import { apiClient, type Watchlist } from '@/lib/api';
import { Plus, Loader2, Download, Upload, Shield, Car, Eye, CreditCard, Zap, Moon, MapPin, Repeat, Pencil, Trash2, Activity, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatDateTime } from './widgets/utils';
import { ITMSLayout } from './components/ITMSLayout';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

interface Rule {
  id: string;
  name: string;
  description: string;
  conditions: string;
  enabled: boolean;
  iconType: string;
}

const RuleIcon = ({ type, className }: { type: string; className?: string }) => {
  const props = { className: className || "w-4 h-4" };
  const colorProps = (color: string) => ({ className: `${props.className} ${color}` });

  switch (type) {
    case 'repeat': return <Repeat {...colorProps('text-amber-400')} />;
    case 'speed': return <Zap {...colorProps('text-red-400')} />;
    case 'location': return <MapPin {...colorProps('text-indigo-400')} />;
    case 'time': return <Moon {...colorProps('text-blue-400')} />;
    case 'toll': return <CreditCard {...colorProps('text-emerald-400')} />;
    case 'shield': return <Shield {...colorProps('text-red-400')} />;
    case 'eye': return <Eye {...colorProps('text-red-400')} />;
    case 'car': return <Car {...colorProps('text-amber-400')} />;
    default: return <Shield {...colorProps('text-indigo-400')} />;
  }
};

const DEFAULT_RULES: Rule[] = [
  {
    id: 'repeat-offender',
    name: 'Repeat Offender',
    description: 'Auto-add vehicles with 3+ violations in 30 days',
    conditions: 'violations >= 3 AND period <= 30d',
    enabled: true,
    iconType: 'repeat',
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    description: 'Auto-watchlist vehicles caught speeding 50+ km/h over limit',
    conditions: 'speed_over_limit >= 50 km/h',
    enabled: true,
    iconType: 'speed',
  },
  {
    id: 'stolen-vehicle-pattern',
    name: 'Stolen Vehicle Pattern',
    description: 'Flag vehicles seen at 3+ locations in 1 hour',
    conditions: 'distinct_locations >= 3 AND period <= 1h',
    enabled: false,
    iconType: 'location',
  },
  {
    id: 'night-runner',
    name: 'Night Runner',
    description: 'Flag vehicles with violations between 11PM-5AM',
    conditions: 'violation_time >= 23:00 OR violation_time <= 05:00',
    enabled: false,
    iconType: 'time',
  },
  {
    id: 'evader',
    name: 'Toll Evader',
    description: 'Flag vehicles that bypass toll plazas without payment',
    conditions: 'toll_events.unpaid >= 2 AND period <= 7d',
    enabled: true,
    iconType: 'toll',
  },
];

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  rules: Omit<Rule, 'id'>[];
}

const TEMPLATES: Template[] = [
  {
    id: 'law-enforcement',
    name: 'Law Enforcement',
    description: 'Stolen vehicles, wanted persons, BOLO alerts',
    icon: <Shield className="w-8 h-8 text-red-400" />,
    rules: [
      { name: 'Stolen Vehicle Alert', description: 'Flag vehicles reported as stolen', conditions: 'status = STOLEN', enabled: true, iconType: 'shield' },
      { name: 'BOLO Match', description: 'Match Be-On-Lookout plate numbers', conditions: 'plate IN bolo_list', enabled: true, iconType: 'eye' },
    ],
  },
  {
    id: 'traffic-management',
    name: 'Traffic Management',
    description: 'Repeat violators, commercial vehicles, overweight loads',
    icon: <Car className="w-8 h-8 text-amber-400" />,
    rules: [
      { name: 'Repeat Violator', description: 'Auto-add vehicles with 5+ violations in 60 days', conditions: 'violations >= 5 AND period <= 60d', enabled: true, iconType: 'repeat' },
      { name: 'Commercial Overweight', description: 'Flag commercial vehicles exceeding weight limits', conditions: 'vehicle_type = TRUCK AND weight > limit', enabled: true, iconType: 'car' },
    ],
  },
  {
    id: 'event-security',
    name: 'Event Security',
    description: 'VIP vehicles, restricted access zones, perimeter control',
    icon: <Eye className="w-8 h-8 text-indigo-400" />,
    rules: [
      { name: 'VIP Escort', description: 'Track VIP convoy vehicles in real-time', conditions: 'plate IN vip_list', enabled: true, iconType: 'shield' },
      { name: 'Restricted Zone Breach', description: 'Alert on unauthorized entry to restricted zones', conditions: 'zone = RESTRICTED AND plate NOT IN whitelist', enabled: true, iconType: 'location' },
    ],
  },
  {
    id: 'toll-evasion',
    name: 'Toll Evasion',
    description: 'Vehicles evading toll plazas, repeat non-payment offenders',
    icon: <CreditCard className="w-8 h-8 text-emerald-400" />,
    rules: [
      { name: 'Toll Evader', description: 'Flag vehicles bypassing toll plazas', conditions: 'toll_events.unpaid >= 2 AND period <= 7d', enabled: true, iconType: 'toll' },
      { name: 'Repeat Non-Payment', description: 'Escalate chronic non-payment offenders', conditions: 'toll_events.unpaid >= 5 AND period <= 30d', enabled: true, iconType: 'toll' },
    ],
  },
];

const ANALYTICS_CHART_DATA = [
  { name: 'Repeat Offender', matches: 42 },
  { name: 'Speed Demon', matches: 28 },
  { name: 'Stolen Pattern', matches: 8 },
  { name: 'Night Runner', matches: 15 },
  { name: 'Toll Evader', matches: 22 },
];

const RECENT_MATCHES = [
  { id: '1', rule: 'Repeat Offender', plate: 'MH-12-AB-1234', time: '2026-01-31T09:42:00Z', confidence: 0.95 },
  { id: '2', rule: 'Speed Demon', plate: 'KA-01-CD-5678', time: '2026-01-31T09:38:00Z', confidence: 0.88 },
  { id: '3', rule: 'Night Runner', plate: 'DL-04-EF-9012', time: '2026-01-31T03:15:00Z', confidence: 0.92 },
  { id: '4', rule: 'Toll Evader', plate: 'TN-07-GH-3456', time: '2026-01-31T08:55:00Z', confidence: 0.97 },
  { id: '5', rule: 'Stolen Pattern', plate: 'GJ-05-IJ-7890', time: '2026-01-31T07:20:00Z', confidence: 0.82 },
];

// Helper function to reconstruct rules on import
const reconstructRules = (imported: any[]): Rule[] => {
  if (!Array.isArray(imported)) return [];

  return imported
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      // Only extract data properties, ignore any 'icon' object in JSON
      id: String(r.id || `imported-${Date.now()}-${Math.random()}`),
      name: String(r.name || 'Unnamed Rule'),
      description: String(r.description || ''),
      conditions: String(r.conditions || ''),
      enabled: Boolean(r.enabled),
      iconType: String(r.iconType || 'default'),
    }));
};

export function WatchlistRulesEngine() {
  const [watchlist, setWatchlist] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rules');
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [newRule, setNewRule] = useState({ name: '', description: '', conditions: '' });

  const fetchWatchlist = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getWatchlist();
      setWatchlist(data);
    } catch (err) {
      console.error('Failed to fetch watchlist:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatchlist();
  }, []);

  const [appliedTemplates, setAppliedTemplates] = useState<Set<string>>(new Set());

  const handleApplyTemplate = (template: Template) => {
    const newRules = template.rules.map((r, i) => ({
      ...r,
      id: `${template.id}-${i}-${Date.now()}`,
    }));
    setRules((prev) => [...prev, ...newRules]);
    setAppliedTemplates((prev) => new Set(prev).add(template.id));
    setActiveTab('rules');
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setNewRule({
      name: rule.name,
      description: rule.description,
      conditions: rule.conditions,
    });
    setShowCreateDialog(true);
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const result = ev.target?.result as string;
          if (!result) return;

          const imported = JSON.parse(result);
          if (Array.isArray(imported)) {
            const reconstructed = reconstructRules(imported);
            if (reconstructed.length === 0) {
              alert('No valid rules found in file');
              return;
            }
            setRules(reconstructed);
            setActiveTab('rules');
          } else {
            alert('Invalid file format: Expected an array of rules');
          }
        } catch (err) {
          console.error('Import error:', err);
          alert('Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(rules, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchlist-rules-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateRule = () => {
    if (!newRule.name.trim()) return;

    if (editingRule) {
      // Update existing rule
      setRules((prev) =>
        prev.map((r) =>
          r.id === editingRule.id
            ? { ...r, name: newRule.name, description: newRule.description, conditions: newRule.conditions }
            : r
        )
      );
      setEditingRule(null);
    } else {
      // Create new rule
      const rule: Rule = {
        id: `custom-${Date.now()}`,
        name: newRule.name,
        description: newRule.description,
        conditions: newRule.conditions,
        enabled: true,
        iconType: 'shield',
      };
      setRules((prev) => [...prev, rule]);
    }

    setNewRule({ name: '', description: '', conditions: '' });
    setShowCreateDialog(false);
  };

  return (
    <ITMSLayout>
      <div className="h-full w-full space-y-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-bold text-zinc-100">Watchlist Rules Engine</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Rule
            </Button>
            <Button variant="secondary" onClick={handleImport}>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button variant="secondary" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Create Rule Dialog */}
        {showCreateDialog && (
          <Card className="bg-zinc-900/30 border border-white/5 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-100">{editingRule ? 'Edit Rule' : 'New Rule'}</h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-100" onClick={() => {
                setShowCreateDialog(false);
                setEditingRule(null);
              }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Name</label>
                <Input
                  placeholder="e.g. Repeat Offender"
                  value={newRule.name}
                  onChange={(e) => setNewRule((p) => ({ ...p, name: e.target.value }))}
                  className="bg-zinc-900/50 border-white/10 text-zinc-300"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Description</label>
                <Input
                  placeholder="What does this rule do?"
                  value={newRule.description}
                  onChange={(e) => setNewRule((p) => ({ ...p, description: e.target.value }))}
                  className="bg-zinc-900/50 border-white/10 text-zinc-300"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Conditions</label>
                <Input
                  placeholder="e.g. violations >= 3 AND period <= 30d"
                  value={newRule.conditions}
                  onChange={(e) => setNewRule((p) => ({ ...p, conditions: e.target.value }))}
                  className="bg-zinc-900/50 border-white/10 text-zinc-300 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => {
                  setShowCreateDialog(false);
                  setEditingRule(null);
                }}>Cancel</Button>
                <Button onClick={handleCreateRule} disabled={!newRule.name.trim()}>{editingRule ? 'Update' : 'Create'}</Button>
              </div>
            </div>
          </Card>
        )}

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-4 bg-zinc-900/50 border border-white/5">
            <TabsTrigger value="rules" className="text-xs">Rules</TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">Templates</TabsTrigger>
            <TabsTrigger value="watchlist" className="text-xs">Watchlist</TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="space-y-4">
            <Card className="bg-zinc-900/30 border border-white/5 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-zinc-100">Automated Rules</h2>
                <HudBadge variant="info">{rules.filter(r => r.enabled).length} active</HudBadge>
              </div>
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="bg-zinc-900/50 border border-white/5 rounded-lg p-4 flex flex-col sm:flex-row items-start gap-4"
                  >
                    <div className="mt-1 flex-shrink-0">
                      <RuleIcon type={rule.iconType} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-bold text-zinc-100">{rule.name}</span>
                        {rule.enabled ? (
                          <HudBadge variant="success">Enabled</HudBadge>
                        ) : (
                          <HudBadge variant="secondary">Disabled</HudBadge>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 mb-2">{rule.description}</p>
                      <div className="text-xs text-zinc-500 font-mono bg-black/20 rounded px-2 py-1 inline-block break-all">
                        {rule.conditions}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Toggle switch */}
                      <button
                        onClick={() => setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                        className={`relative w-10 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-indigo-600' : 'bg-zinc-700'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-100" onClick={() => handleEditRule(rule)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-red-400" onClick={() => handleDeleteRule(rule.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <Card className="bg-zinc-900/30 border border-white/5 p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4">Watchlist Templates</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className="bg-zinc-900/50 border border-white/5 rounded-lg p-5 flex flex-col items-center text-center hover:border-indigo-500/30 transition-colors"
                  >
                    <div className="mb-3 p-3 bg-black/20 rounded-full">
                      {template.icon}
                    </div>
                    <h3 className="text-sm font-bold text-zinc-100 mb-1">{template.name}</h3>
                    <p className="text-xs text-zinc-400 mb-4">{template.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-xs"
                      onClick={() => handleApplyTemplate(template)}
                      disabled={appliedTemplates.has(template.id)}
                    >
                      {appliedTemplates.has(template.id) ? 'Applied' : 'Use Template'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-4">
            <Card className="bg-zinc-900/30 border border-white/5 p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4">Active Watchlist</h2>
              <div className="space-y-2">
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400 mx-auto" />
                ) : watchlist.length > 0 ? (
                  watchlist.map((item) => (
                    <Card key={item.id} className="bg-zinc-900/50 border border-white/5 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-bold text-zinc-100 font-mono">
                          {item.vehicle?.plateNumber || 'UNKNOWN'}
                        </div>
                        <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs">
                          {item.reason}
                        </Badge>
                      </div>
                      <div className="text-xs text-zinc-500">
                        Added: {formatDateTime(item.createdAt)}
                      </div>
                    </Card>
                  ))
                ) : (
                  <Empty>
                    <EmptyIcon><Car /></EmptyIcon>
                    <EmptyTitle>No watchlisted vehicles</EmptyTitle>
                    <EmptyDescription>Vehicles added to the watchlist will appear here.</EmptyDescription>
                  </Empty>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            {/* Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Rules Active', value: '5', color: 'text-indigo-400' },
                { label: 'Matches Today', value: '115', color: 'text-emerald-400' },
                { label: 'False Positive Rate', value: '4.2%', color: 'text-amber-400' },
                { label: 'Avg Response Time', value: '1.2s', color: 'text-cyan-400' },
              ].map((stat) => (
                <Card key={stat.label} className="bg-zinc-900/30 border border-white/5 p-4 text-center">
                  <div className="text-xs text-zinc-500 mb-1">{stat.label}</div>
                  <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
                </Card>
              ))}
            </div>

            {/* Bar Chart */}
            <Card className="bg-zinc-900/30 border border-white/5 p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4">Matches by Rule</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ANALYTICS_CHART_DATA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e4e4e7' }}
                    />
                    <Bar dataKey="matches" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Recent Matches */}
            <Card className="bg-zinc-900/30 border border-white/5 p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-4">Recent Matches</h2>
              <div className="space-y-2">
                {RECENT_MATCHES.map((match) => (
                  <div key={match.id} className="bg-zinc-900/50 border border-white/5 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Activity className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-zinc-100 font-mono truncate">{match.plate}</div>
                        <div className="text-xs text-zinc-500">{match.rule}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <HudBadge variant="info">{(match.confidence * 100).toFixed(0)}%</HudBadge>
                      <span className="text-xs text-zinc-500 font-mono">{formatDateTime(match.time)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ITMSLayout>
  );
}
