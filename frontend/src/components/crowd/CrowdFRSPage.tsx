import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  Eye, Users, Activity, Search, Upload, Plus, Monitor,
  AlertTriangle, FileText, X, Loader2, Trash, Edit,
  RefreshCw, ScanFace, UserX, Camera, UserCheck, Cpu, Wifi,
} from 'lucide-react';
import { WebSocketVideoFrame } from '@/components/cameras/WebSocketVideoFrame';
import { useToast } from "@/components/ui/use-toast";
import { apiClient } from '@/lib/api';
import { pdf } from '@react-pdf/renderer';
import { FRSReportPDF } from './FRSReportPDF';
import { cn } from '@/lib/utils';
import { recordReportEvent } from '@/lib/reportHistory';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { FRSGlobalIdentity, FRSMatch, Person } from '@/lib/api';


interface CrowdAlert {
  id: number;
  deviceId: string;
  alertType: string;
  title: string;
  description: string;
  timestamp: string;
  severity: string;
  metadata: any;
  isResolved: boolean;
  device?: { name: string };
}

const normalizeAlertTitle = (value: unknown) => {
  const text = typeof value === 'string' ? value : value ? String(value) : '';
  const cleaned = text.replace(/Person of Interest Detected: /i, '').trim();
  return cleaned || 'Unknown Subject';
};

const formatMetadata = (val: any) => {
  if (val === undefined || val === null || val === '') return 'N/A';
  const str = String(val).replace(/^(age_|gender_)/i, '').replace(/_/g, ' ');
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

const timeAgo = (ts: string) => {
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const ThreatBadge = ({ level }: { level?: string }) => {
  const l = level?.toLowerCase();
  return (
    <Badge className={cn(
      "text-[8px] h-4 px-1.5 font-bold border-0 shrink-0",
      l === 'high' ? "bg-red-500/20 text-red-400" :
        l === 'medium' ? "bg-amber-500/20 text-amber-400" :
          "bg-emerald-500/20 text-emerald-400"
    )}>
      {level?.toUpperCase() || 'MEDIUM'}
    </Badge>
  );
};

const CategoryBadge = ({ category }: { category?: string }) => (
  <Badge className="text-[8px] h-4 px-1.5 bg-primary/10 text-primary/80 font-mono border-0 shrink-0">
    {category === 'Warrant' ? 'WANTED' : category?.toUpperCase() || 'N/A'}
  </Badge>
);

const PersonCard = ({ person, idx, onClick, compact }: { person: Person; idx: number; onClick: () => void; compact?: boolean }) => (
  <div
    onClick={onClick}
    className={cn(
      "flex gap-3 p-2.5 rounded-lg cursor-pointer transition-all border group",
      person.threatLevel === 'High'
        ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
    )}
  >
    <div className={cn(
      "rounded-md bg-black shrink-0 overflow-hidden border border-white/10",
      compact ? "h-10 w-10" : "h-12 w-12"
    )}>
      <img src={person.faceImageUrl} className="w-full h-full object-cover" alt="" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[11px] text-white truncate">{person.name}</p>
        <span className="text-[9px] font-mono text-muted-foreground shrink-0">#{String(idx + 1).padStart(3, '0')}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        <ThreatBadge level={person.threatLevel} />
        <CategoryBadge category={person.category} />
        {person.threatLevel === 'High' && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
      </div>
      {!compact && person.aliases && (
        <p className="text-[8px] text-muted-foreground mt-1 truncate">AKA: {person.aliases}</p>
      )}
    </div>
  </div>
);

const MatchThumbnail = ({
  match,
  persons,
  onClick,
  onAddToGallery
}: {
  match: CrowdAlert;
  persons: Person[];
  onClick: () => void;
  onAddToGallery?: (match: CrowdAlert, person: Person) => void;
}) => {
  const personId = match.metadata?.person_id;
  const matchedPerson = personId ? persons.find(p => String(p.id) === String(personId)) : null;
  const displayName = matchedPerson?.name || match.metadata?.person_name || match.title;
  const matchScore = match.metadata?.match_score || 0;
  const qualityScore = match.metadata?.quality_score || 0;

  // Show add button if it's a known face with good quality
  const showAddButton = matchedPerson && qualityScore > 0.7 && matchScore > 0.35;

  return (
    <div
      className="flex gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-all border border-transparent hover:border-white/10 relative group"
    >
      <div onClick={onClick} className="flex gap-3 flex-1">
        <div className="h-11 w-[72px] flex rounded-md overflow-hidden border border-white/10 shrink-0">
          <div className="w-1/2 h-full bg-black border-r border-white/5 relative">
            <img
              src={matchedPerson?.faceImageUrl || match.metadata?.images?.['face.jpg']}
              className="w-full h-full object-cover"
              alt=""
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[5px] text-center text-white/80 font-bold uppercase py-px">Ref</div>
          </div>
          <div className="w-1/2 h-full bg-black relative">
            <img
              src={match.metadata?.images?.['face.jpg'] || match.metadata?.images?.['frame.jpg']}
              className="w-full h-full object-cover"
              alt=""
            />
            <div className="absolute inset-x-0 bottom-0 iris-cut-tag-base iris-cut-tag-default text-[5px] text-center text-white font-bold uppercase py-px">Live</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p className="font-semibold text-[11px] truncate text-white">{normalizeAlertTitle(displayName)}</p>
          <p className="text-[9px] text-muted-foreground font-medium truncate">
            {matchedPerson?.category || match.metadata?.person_category || match.deviceId || 'Station HQ'}
          </p>
          <p className="text-[8px] text-muted-foreground/60 mt-0.5">{timeAgo(match.timestamp)}</p>
        </div>
        <div className="flex items-center">
          <Eye className="h-3 w-3 text-white/20 group-hover:text-primary/60" />
        </div>
      </div>

      {/* Add to Gallery Button */}
      {showAddButton && onAddToGallery && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToGallery(match, matchedPerson);
          }}
          className="absolute top-1 right-1 bg-emerald-500/80 hover:bg-emerald-500 text-white text-[8px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
          title="Add this snapshot to person's gallery for improved matching"
        >
          <Plus className="h-2.5 w-2.5" />
          Gallery
        </button>
      )}
    </div>
  );
};


export function CrowdFRSPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('live');


  // Watchlist State
  const [persons, setPersons] = useState<Person[]>([]);
  const [filteredPersons, setFilteredPersons] = useState<Person[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [, setLoadingPersons] = useState(false);
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'high' | 'wanted'>('all');

  // Person Profile Modal State
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personHistory, setPersonHistory] = useState<CrowdAlert[]>([]);
  const [, setLoadingHistory] = useState(false);

  // Enrollment State
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ name: '', age: '', gender: '', height: '', category: '', threatLevel: '', notes: '', addToWatchlist: false });
  const [enrollFile, setEnrollFile] = useState<File | null>(null);
  const [enrollFiles, setEnrollFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Search Tab State
  const [searchForm, setSearchForm] = useState({ name: '', age: '', gender: 'male', threatLevel: 'medium', status: 'wanted', height: '', aliases: '', notes: '' });
  const [searchFile, setSearchFile] = useState<File | null>(null);
  const [searchPreview, setSearchPreview] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const searchNameInputRef = useRef<HTMLInputElement | null>(null);
  const [showPersonEditModal, setShowPersonEditModal] = useState(false);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState({ name: '', age: '', gender: '', threatLevel: '', status: '', height: '', aliases: '', category: '', notes: '' });
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [editPreviews, setEditPreviews] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Alerts State
  const [alerts, setAlerts] = useState<CrowdAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<CrowdAlert | null>(null);
  const [, setLoadingAlerts] = useState(false);

  // Live View State
  const [liveMatches, setLiveMatches] = useState<CrowdAlert[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<CrowdAlert | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);

  // Match Modal Image Upload State
  const [matchModalFiles, setMatchModalFiles] = useState<File[]>([]);
  const [matchModalPreviews, setMatchModalPreviews] = useState<string[]>([]);
  const [isAddingToGallery, setIsAddingToGallery] = useState(false);
  // Unknown Faces State
  const [unknownFaces, setUnknownFaces] = useState<any[]>([]);
  const [selectedUnknown, setSelectedUnknown] = useState<any | null>(null);
  const [loadingUnknown, setLoadingUnknown] = useState(false);

  // Global Identity (ReID) State
  const [globalIdentities, setGlobalIdentities] = useState<FRSGlobalIdentity[]>([]);
  const [selectedGlobalIdentity, setSelectedGlobalIdentity] = useState<FRSGlobalIdentity | null>(null);
  const [globalTimeline, setGlobalTimeline] = useState<FRSMatch[]>([]);
  const [loadingGlobalIdentities, setLoadingGlobalIdentities] = useState(false);
  const [loadingGlobalTimeline, setLoadingGlobalTimeline] = useState(false);

  // Unknown Face Conversion State
  const [selectedUnknownForConversion, setSelectedUnknownForConversion] = useState<any | null>(null);
  const [showConvertUnknownDialog, setShowConvertUnknownDialog] = useState(false);
  const [conversionMode, setConversionMode] = useState<'create' | 'link'>('create');
  const [selectedPersonForLink, setSelectedPersonForLink] = useState<Person | null>(null);
  const [convertForm, setConvertForm] = useState({
    name: '',
    category: 'person_of_interest',
    threatLevel: 'low',
    age: '',
    gender: 'unknown',
    height: '',
    aliases: '',
    notes: '',
    addToWatchlist: false
  });
  const [isConverting, setIsConverting] = useState(false);

  // Person Gallery State
  const [personGalleryImages] = useState<string[]>([]);
  const [loadingGallery] = useState(false);

  // Jetson workers + cameras for live feed
  const [jetsons, setJetsons] = useState<Array<{
    workerId: string; name: string; reachable: boolean; cameraCount: number;
    resources?: { cpu_load_1m?: number; memory_percent?: number; temperature_c?: number };
  }>>([]);
  const [camerasByWorker, setCamerasByWorker] = useState<Record<string, Array<{ id: string; name: string }>>>({});

  useEffect(() => {
    fetchPersons();
    fetchAlerts();
    if (activeTab === 'identified') fetchGlobalIdentities();
    if (activeTab === 'unknown') fetchUnknownFaces();
    const interval = setInterval(() => {
      if (activeTab === 'alerts') fetchAlerts();
      if (activeTab === 'live') fetchLiveMatches();
      if (activeTab === 'identified') fetchGlobalIdentities();
      if (activeTab === 'unknown') fetchUnknownFaces();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Fetch Jetson workers + cameras for the live feed
  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, workerConfigs] = await Promise.all([
          apiClient.getWorkerLiveStats(),
          fetch('/api/analytics/worker-configs').then(r => r.json()),
        ]);
        setJetsons(statsRes.workers.map(w => ({
          workerId: w.workerId,
          name: w.name,
          reachable: w.reachable,
          cameraCount: w.cameraCount,
          resources: w.resources ?? undefined,
        })));
        const cameras: Array<{ id: string; name: string; workerId?: string | null }> =
          workerConfigs?.data ?? [];
        const byWorker: Record<string, Array<{ id: string; name: string }>> = {};
        for (const cam of cameras) {
          if (!cam.workerId) continue;
          if (!byWorker[cam.workerId]) byWorker[cam.workerId] = [];
          byWorker[cam.workerId].push({ id: cam.id, name: cam.name });
        }
        setCamerasByWorker(byWorker);
      } catch (_) { /* silent */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let result = persons;
    if (watchlistFilter === 'high') result = result.filter(p => p.threatLevel?.toLowerCase() === 'high');
    if (watchlistFilter === 'wanted') result = result.filter(p => p.category?.toLowerCase() === 'warrant');
    if (searchQuery) result = result.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    setFilteredPersons(result);
  }, [searchQuery, persons, watchlistFilter]);

  useEffect(() => {
    if (selectedPerson) {
      setLoadingHistory(true);
      apiClient.getFRSDetections({ limit: 10, personId: selectedPerson.id })
        .then(data => {
          if (data && data.length > 0) {
            setPersonHistory(data as any);
          } else {
            setPersonHistory([]);
          }
        })
        .catch(() => {
          setPersonHistory([]);
        })
        .finally(() => setLoadingHistory(false));
    }
  }, [selectedPerson]);

  const fetchPersons = async () => {
    setLoadingPersons(true);
    try {
      const data = await apiClient.getPersons();
      setPersons(data);
      setFilteredPersons(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPersons(false);
    }
  };

  const fetchAlerts = async () => {
    setLoadingAlerts(true);
    try {
      // Only fetch known persons for alerts (not unknown faces)
      const data = await apiClient.getFRSDetections({ limit: 50, unknown: false });
      setAlerts(data as any);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAlerts(false);
    }
  };

  const fetchLiveMatches = async () => {
    try {
      // Only fetch known faces (with person_id) for Live Monitor
      const data = await apiClient.getFRSDetections({ limit: 10, unknown: false });
      setLiveMatches(prev => {
        const newMatches = data.filter((d: any) => !prev.find(p => p.id === d.id));
        return [...newMatches, ...prev].slice(0, 50) as any;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUnknownFaces = async () => {
    setLoadingUnknown(true);
    try {
      const data = await apiClient.getFRSDetections({ limit: 100, unknown: true });
      setUnknownFaces(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUnknown(false);
    }
  };

  const fetchGlobalIdentities = async () => {
    setLoadingGlobalIdentities(true);
    try {
      const data = await apiClient.getFRSGlobalIdentities({ limit: 200 });
      setGlobalIdentities(data);

      // Keep selection stable when data refreshes.
      if (selectedGlobalIdentity) {
        const updated = data.find((g) => g.globalIdentityId === selectedGlobalIdentity.globalIdentityId);
        if (updated) {
          setSelectedGlobalIdentity(updated);
        } else {
          setSelectedGlobalIdentity(null);
          setGlobalTimeline([]);
        }
      } else if (data.length > 0) {
        setSelectedGlobalIdentity(data[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGlobalIdentities(false);
    }
  };

  const fetchGlobalIdentityTimeline = async (globalIdentityId: string) => {
    if (!globalIdentityId) return;
    setLoadingGlobalTimeline(true);
    try {
      const data = await apiClient.getFRSGlobalIdentityDetections(globalIdentityId, 400);
      setGlobalTimeline(data);
    } catch (e) {
      console.error(e);
      setGlobalTimeline([]);
    } finally {
      setLoadingGlobalTimeline(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'identified' || !selectedGlobalIdentity?.globalIdentityId) return;
    fetchGlobalIdentityTimeline(selectedGlobalIdentity.globalIdentityId);
  }, [activeTab, selectedGlobalIdentity?.globalIdentityId]);

  const handleConvertUnknownToPerson = async () => {
    if (!selectedUnknownForConversion || !convertForm.name) {
      toast({
        title: 'Missing Name',
        description: 'Please enter a name for this person.',
        variant: 'destructive'
      });
      return;
    }

    setIsConverting(true);
    try {
      // Get the face image URL from metadata
      const faceImageUrl = selectedUnknownForConversion.faceSnapshotUrl ||
        selectedUnknownForConversion.metadata?.images?.['face.jpg'] ||
        selectedUnknownForConversion.metadata?.images?.['face_crop.jpg'];

      if (!faceImageUrl) {
        throw new Error('No face image available for conversion');
      }

      // Fetch the image and convert to blob
      const response = await fetch(faceImageUrl);
      if (!response.ok) throw new Error(`Failed to fetch face image: ${response.statusText}`);
      const blob = await response.blob();

      // Create FormData with image and details
      const formData = new FormData();
      formData.append('images[]', blob, 'face.jpg');
      formData.append('name', convertForm.name);
      if (convertForm.age) formData.append('age', convertForm.age);
      if (convertForm.gender) formData.append('gender', convertForm.gender);
      if (convertForm.height) formData.append('height', convertForm.height);

      // If watchlist is toggled, set high-priority values
      const category = convertForm.addToWatchlist ? 'suspect' : (convertForm.category || 'person_of_interest');
      const threatLevel = convertForm.addToWatchlist ? 'high' : (convertForm.threatLevel || 'low');

      formData.append('category', category);
      formData.append('threatLevel', threatLevel);
      if (convertForm.notes) formData.append('notes', convertForm.notes);

      const result = await apiClient.createPerson(formData);

      if (result) {
        toast({
          title: 'Success',
          description: `${convertForm.name} has been enrolled and added to the database.`,
        });

        // Close dialog and reset form
        setShowConvertUnknownDialog(false);
        setConvertForm({
          name: '',
          category: 'person_of_interest',
          threatLevel: 'low',
          age: '',
          gender: 'unknown',
          height: '',
          aliases: '',
          notes: '',
          addToWatchlist: false
        });

        // Refresh lists
        fetchPersons();
        fetchUnknownFaces();
      }
    } catch (err: any) {
      console.error('Error converting unknown to person:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to create person profile',
        variant: 'destructive'
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleLinkUnknownToPerson = async () => {
    if (!selectedUnknownForConversion || !selectedPersonForLink) {
      toast({ title: 'Missing Selection', description: 'Please select a person to link to.', variant: 'destructive' });
      return;
    }

    setIsConverting(true);
    try {
      // Download the unknown face image
      const faceImageUrl = selectedUnknownForConversion.metadata?.images?.['face.jpg'];
      if (!faceImageUrl) {
        toast({ title: 'Error', description: 'No face image available', variant: 'destructive' });
        return;
      }

      const response = await fetch(faceImageUrl);
      const blob = await response.blob();

      // Add to person's embeddings
      const formData = new FormData();
      formData.append('images[]', blob, 'face.jpg');

      const result = await apiClient.addPersonEmbeddings(selectedPersonForLink.id, formData);

      toast({
        title: 'Face Linked',
        description: `Added to ${selectedPersonForLink.name}'s gallery. Total: ${result.totalEmbeddings} images.`,
        duration: 3000,
      });

      // Reset and close
      setShowConvertUnknownDialog(false);
      setSelectedUnknownForConversion(null);
      setSelectedPersonForLink(null);
      setConversionMode('create');

      // Refresh data
      fetchPersons();
      fetchUnknownFaces();
    } catch (err) {
      console.error('Error linking unknown to person:', err);
      toast({
        title: 'Error',
        description: 'Failed to link face to person',
        variant: 'destructive'
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleEnroll = async () => {
    const filesToUpload = enrollFiles.length > 0 ? enrollFiles : (enrollFile ? [enrollFile] : []);
    if (!enrollForm.name || filesToUpload.length === 0) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      // Append multiple images
      filesToUpload.forEach(file => {
        formData.append('images[]', file);
      });
      formData.append('name', enrollForm.name);
      if (enrollForm.age) formData.append('age', enrollForm.age);
      if (enrollForm.gender) formData.append('gender', enrollForm.gender);
      if (enrollForm.height) formData.append('height', enrollForm.height);
      // If watchlist is toggled, set high-priority values
      const category = enrollForm.addToWatchlist ? 'suspect' : (enrollForm.category || 'person_of_interest');
      const threatLevel = enrollForm.addToWatchlist ? 'high' : (enrollForm.threatLevel || 'medium');

      formData.append('category', category);
      formData.append('threatLevel', threatLevel);
      formData.append('notes', enrollForm.notes || '');
      const res = await apiClient.createPerson(formData);
      if (res) {
        setEnrollForm({ name: '', age: '', gender: '', height: '', category: '', threatLevel: '', notes: '', addToWatchlist: false });
        setEnrollFile(null);
        setEnrollFiles([]);
        setShowEnrollDialog(false);
        fetchPersons();
        toast({ title: 'Success', description: `Person enrolled with ${filesToUpload.length} image(s)` });
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to enroll person', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePerson = async (id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    if (!confirm("Are you sure?")) return;
    try {
      await apiClient.deletePerson(id);
      setPersons(prev => prev.filter(p => p.id !== id));
      setFilteredPersons(prev => prev.filter(p => p.id !== id));
      fetchPersons();
      if (selectedPerson?.id === id) setSelectedPerson(null);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to delete person', variant: 'destructive' });
    }
  };

  const handleSearchImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSearchFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setSearchPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSearchSubmit = async () => {
    if (!searchFile || !searchForm.name) {
      toast({ title: 'Missing Fields', description: 'Please select an image and enter a name.', variant: 'destructive' });
      return;
    }
    setSearchLoading(true);
    try {
      const formData = new FormData();
      formData.append('images[]', searchFile);
      formData.append('name', searchForm.name);
      formData.append('category', searchForm.status);
      formData.append('threatLevel', searchForm.threatLevel);
      formData.append('notes', searchForm.notes || '');
      formData.append('age', searchForm.age);
      formData.append('gender', searchForm.gender);
      formData.append('status', searchForm.status);
      formData.append('height', searchForm.height);
      formData.append('aliases', searchForm.aliases || '');
      const res = await apiClient.createPerson(formData);
      if (res) {
        setSearchResults([res]);
        toast({ title: 'Success', description: 'Search profile created and indexed' });
        fetchPersons();
        setSearchForm({ name: '', age: '', gender: 'male', threatLevel: 'medium', status: 'wanted', height: '', aliases: '', notes: '' });
        setSearchFile(null);
        setSearchPreview(null);
        setSearchResults([]);
        requestAnimationFrame(() => searchNameInputRef.current?.focus());
      }
    } catch (err) {
      console.error("Search error:", err);
      toast({ title: 'Error', description: 'Failed to create search profile', variant: 'destructive' });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddToGallery = async (match: CrowdAlert, person: Person) => {
    try {
      // Get the face snapshot URL
      const faceImageUrl = match.metadata?.images?.['face.jpg'];
      if (!faceImageUrl) {
        toast({ title: 'Error', description: 'No face image available', variant: 'destructive' });
        return;
      }

      // Download the image as blob
      const response = await fetch(faceImageUrl);
      const blob = await response.blob();

      // Create FormData with the image
      const formData = new FormData();
      formData.append('images[]', blob, 'snapshot.jpg');

      // Send to backend
      const result = await apiClient.addPersonEmbeddings(person.id, formData);

      toast({
        title: 'Added to Gallery',
        description: `Snapshot added! ${person.name} now has ${result.totalEmbeddings} embeddings for improved accuracy.`,
        duration: 3000,
      });

      // Refresh persons to get updated embedding count
      fetchPersons();
    } catch (err) {
      console.error('Error adding to gallery:', err);
      toast({
        title: 'Error',
        description: 'Failed to add snapshot to gallery',
        variant: 'destructive'
      });
    }
  };

  const openEditPerson = (person: Person) => {
    setEditPerson(person);
    setEditForm({
      name: person.name || '',
      age: person.age ? String(person.age) : '',
      gender: person.gender || '',
      threatLevel: person.threatLevel || '',
      status: person.status || '',
      height: person.height || '',
      aliases: person.aliases || '',
      category: person.category || '',
      notes: person.notes || '',
    });
    setEditFiles([]);
    setEditPreviews([]);
    setShowPersonEditModal(true);
  };

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      setEditFiles(fileArray);

      // Generate previews for all files
      const previews: string[] = [];
      fileArray.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          previews.push(reader.result as string);
          if (previews.length === fileArray.length) {
            setEditPreviews(previews);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleEditSave = async () => {
    if (!editPerson) return;
    setEditSaving(true);
    try {
      // First update the person details (without image)
      const formData = new FormData();
      formData.append('name', editForm.name);
      formData.append('age', editForm.age);
      formData.append('gender', editForm.gender);
      formData.append('threatLevel', editForm.threatLevel);
      formData.append('status', editForm.status);
      formData.append('height', editForm.height);
      formData.append('aliases', editForm.aliases);
      formData.append('category', editForm.category);
      formData.append('notes', editForm.notes);

      const updated = await apiClient.updatePerson(editPerson.id, formData);

      // If there are new images, add them to embeddings
      if (editFiles.length > 0) {
        const imageFormData = new FormData();
        editFiles.forEach(file => {
          imageFormData.append('images[]', file);
        });
        await apiClient.addPersonEmbeddings(editPerson.id, imageFormData);
      }

      setPersons(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setFilteredPersons(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      if (selectedPerson?.id === updated.id) setSelectedPerson(updated);
      setShowPersonEditModal(false);
      toast({
        title: 'Updated',
        description: editFiles.length > 0
          ? `Person details saved and ${editFiles.length} image(s) added to gallery.`
          : 'Person details saved.'
      });
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to update person', variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  };

  const openMatchDetail = (match: CrowdAlert) => {
    setSelectedMatch(match);
    setShowMatchModal(true);
    // Reset match modal upload state
    setMatchModalFiles([]);
    setMatchModalPreviews([]);
  };

  const handleMatchModalImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      setMatchModalFiles(fileArray);

      // Generate previews for all files
      const previews: string[] = [];
      fileArray.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          previews.push(reader.result as string);
          if (previews.length === fileArray.length) {
            setMatchModalPreviews(previews);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleMatchModalAddToGallery = async () => {
    if (!selectedMatch || matchModalFiles.length === 0) return;

    const personId = selectedMatch.metadata?.person_id;
    const matchedPerson = persons.find(p => String(p.id) === String(personId));

    if (!matchedPerson) {
      toast({ title: 'Error', description: 'No person profile found for this match', variant: 'destructive' });
      return;
    }

    setIsAddingToGallery(true);
    try {
      const formData = new FormData();
      matchModalFiles.forEach(file => {
        formData.append('images[]', file);
      });

      const result = await apiClient.addPersonEmbeddings(matchedPerson.id, formData);

      toast({
        title: 'Added to Gallery',
        description: `${matchModalFiles.length} image(s) added! ${matchedPerson.name} now has ${result.totalEmbeddings} embeddings.`,
        duration: 3000,
      });

      // Reset upload state
      setMatchModalFiles([]);
      setMatchModalPreviews([]);

      // Refresh persons to get updated embedding count
      fetchPersons();
    } catch (err) {
      console.error('Error adding to gallery:', err);
      toast({
        title: 'Error',
        description: 'Failed to add images to gallery',
        variant: 'destructive'
      });
    } finally {
      setIsAddingToGallery(false);
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const highThreatCount = persons.filter(p => p.threatLevel?.toLowerCase() === 'high').length;
  const wantedCount = persons.filter(p => p.category?.toLowerCase() === 'warrant').length;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const generatedAt = new Date().toLocaleString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const blob = await pdf(
        <FRSReportPDF
          persons={filteredPersons}
          detections={alerts as any}
          reportTitle="FRS Watchlist & Detection Report"
          generatedAt={generatedAt}
          filters={{
            watchlistFilter: watchlistFilter,
            searchQuery: searchQuery || undefined,
          }}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = `FRS-Report-${Date.now()}.pdf`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      recordReportEvent({
        title: 'FRS Watchlist & Detection Report',
        module: 'FRS',
        route: '/frs',
        format: 'pdf',
        status: 'downloaded',
        query: JSON.stringify({
          watchlistFilter,
          searchQuery: searchQuery || undefined,
          filename,
        }),
      });
      toast({ title: 'Export Complete', description: 'FRS report downloaded successfully.' });
    } catch (err) {
      console.error('Failed to generate FRS report:', err);
      toast({ title: 'Export Failed', description: 'Failed to generate report PDF.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([fetchPersons(), fetchAlerts()]);
    toast({ title: 'Refreshed', description: 'Data updated successfully.' });
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden iris-dashboard-root iris-frs-theme relative">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full min-h-0">
        {/* Tab Header */}
        <div className="shrink-0 px-4 pt-4 lg:px-6 lg:pt-5 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <TabsList className="bg-zinc-900/50 p-1 border border-white/10 h-9 w-full sm:w-auto justify-start">
              <TabsTrigger value="live" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <Monitor className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Live</span> Monitor
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <Users className="h-3.5 w-3.5" /> Watchlist
              </TabsTrigger>
              <TabsTrigger value="identified" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <UserCheck className="h-3.5 w-3.5" /> Identified
              </TabsTrigger>
              <TabsTrigger value="search" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <Search className="h-3.5 w-3.5" /> Search
              </TabsTrigger>
              <TabsTrigger value="alerts" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <AlertTriangle className="h-3.5 w-3.5" /> Alerts
              </TabsTrigger>
              <TabsTrigger value="unknown" className="gap-1.5 px-3 text-xs data-[state=active]:bg-white/[0.06]">
                <UserX className="h-3.5 w-3.5" /> Unknown
              </TabsTrigger>
            </TabsList>

            {/* Status Indicators */}
            <div className="flex items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-500 font-medium">Engine Online</span>
              </div>
              <Separator orientation="vertical" className="h-3 bg-white/10" />
              <span className="text-muted-foreground"><span className="text-white font-medium">{persons.length}</span> Indexed</span>
              <Separator orientation="vertical" className="h-3 bg-white/10" />
              <span className="text-muted-foreground">Latency: <span className="text-white font-medium">42ms</span></span>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 px-4 pb-4 lg:px-6 lg:pb-6 overflow-hidden">

          {/* ═══════════════ LIVE MONITOR TAB ═══════════════ */}
          <TabsContent value="live" className="h-full m-0 flex flex-col lg:flex-row gap-4">
            {/* Sidebar - Matches */}
            <Card className="w-full lg:w-64 xl:w-72 flex flex-col shrink-0 border border-white/5 bg-zinc-900/30 overflow-hidden max-h-[280px] lg:max-h-none">
              <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative flex items-center justify-center w-7 h-7">
                    <div className="absolute inset-0 border border-primary/30 rounded-full animate-[spin_4s_linear_infinite]" />
                    <ScanFace className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-white">Face Matches</p>
                    <p className="text-[8px] text-muted-foreground">{liveMatches.length} detections</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-white"
                  onClick={() => setLiveMatches([])}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {liveMatches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center h-full min-h-[80px] text-muted-foreground/30">
                    <ScanFace className="h-6 w-6 mb-2 opacity-40" />
                    <p className="text-[10px]">Waiting for detections...</p>
                  </div>
                ) : (
                  liveMatches
                    // Client-side filter: only show known faces (defense-in-depth)
                    .filter((match) => {
                      const personId = match.metadata?.person_id;
                      const isKnown = match.metadata?.is_known;
                      // Include if has person_id OR is_known is explicitly true
                      return personId || isKnown === true;
                    })
                    .map((match) => (
                      <MatchThumbnail
                        key={match.id}
                        match={match}
                        persons={persons}
                        onClick={() => openMatchDetail(match)}
                        onAddToGallery={handleAddToGallery}
                      />
                    ))
                )}
              </div>
            </Card>

            {/* Main Grid Area — Live Jetson Feeds */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
              {/* Empty watchlist notice */}
              {persons.length === 0 && (
                <div className="shrink-0 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>No face data enrolled — FRS inference is paused. Enroll persons in the <button className="underline" onClick={() => setActiveTab('watchlist')}>Watchlist</button> tab to enable recognition.</span>
                </div>
              )}

              {jetsons.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/30 py-16">
                  <Wifi className="h-8 w-8 mb-3" />
                  <p className="text-sm">Loading Jetson feeds…</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {jetsons.map(jetson => {
                    const cameras = camerasByWorker[jetson.workerId] ?? [];
                    return (
                      <div key={jetson.workerId}>
                        {/* Jetson header */}
                        <div className="flex items-center gap-2 mb-2">
                          <Cpu className="h-3.5 w-3.5 text-primary/70" />
                          <span className="text-[11px] font-semibold text-white">{jetson.name}</span>
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            jetson.reachable ? "bg-emerald-500" : "bg-red-500"
                          )} />
                          <span className="text-[9px] text-muted-foreground">{jetson.reachable ? 'online' : 'offline'}</span>
                          {jetson.resources?.temperature_c != null && (
                            <span className="text-[9px] text-muted-foreground ml-auto font-mono">{jetson.resources.temperature_c}°C · {jetson.resources.memory_percent?.toFixed(0)}% mem</span>
                          )}
                        </div>

                        {cameras.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-white/10 bg-black/10 py-6 text-center text-[10px] text-muted-foreground/40">
                            No cameras assigned
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            {cameras.map(cam => (
                              <div key={cam.id} className="relative aspect-video rounded-lg border border-white/10 bg-black overflow-hidden group">
                                <WebSocketVideoFrame
                                  workerId={jetson.workerId}
                                  cameraId={cam.id}
                                  serviceFilter="frs"
                                  enabledServices={['frs']}
                                  showOverlays={false}
                                  className="w-full h-full object-cover"
                                />
                                {/* LIVE badge */}
                                <div className="absolute top-1.5 left-1.5 pointer-events-none">
                                  <div className="bg-red-500/90 backdrop-blur px-1.5 py-0.5 rounded text-[7px] font-bold text-white flex items-center gap-1">
                                    <div className="w-1 h-1 rounded-full bg-white animate-pulse" /> LIVE
                                  </div>
                                </div>
                                {/* Camera name */}
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-4 pointer-events-none">
                                  <p className="text-white text-[8px] font-medium truncate">{cam.name}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══════════════ WATCHLIST TAB ═══════════════ */}
          <TabsContent value="watchlist" className="h-full m-0 flex flex-col gap-4">
            {/* Toolbar */}
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    className="h-8 pl-8 text-xs bg-zinc-900/60 border-white/5"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1 bg-zinc-900/60 p-0.5 rounded-lg border border-white/5">
                  {(['all', 'high', 'wanted'] as const).map((f) => (
                    <Button
                      key={f}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 px-2.5 text-[10px]",
                        watchlistFilter === f ? "bg-white/[0.08] text-white" : "text-muted-foreground hover:text-white"
                      )}
                      onClick={() => setWatchlistFilter(f)}
                    >
                      {f === 'all' ? `All (${persons.length})` : f === 'high' ? `High Threat (${highThreatCount})` : `Wanted (${wantedCount})`}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/20"
                  onClick={() => setShowEnrollDialog(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Enroll Person
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-white/10 text-muted-foreground"
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  {isExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
              </div>
            </div>

            {/* Stats Row */}
            <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-white/5 bg-zinc-900/30 p-3">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Total Records</p>
                <p className="text-xl font-bold text-white mt-1">{persons.length}</p>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-[9px] text-red-400 uppercase tracking-wider font-medium">High Threat</p>
                <p className="text-xl font-bold text-red-400 mt-1">{highThreatCount}</p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Wanted Persons</p>
                <p className="text-xl font-bold text-amber-400 mt-1">{wantedCount}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-[9px] text-emerald-400 uppercase tracking-wider font-medium">Cleared</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{persons.length - highThreatCount - wantedCount}</p>
              </div>
            </div>

            {/* Person Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/5 bg-zinc-900/20 p-3">
              {filteredPersons.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40">
                  <Users className="h-10 w-10 mb-3" />
                  <p className="text-sm font-medium">No persons found</p>
                  <p className="text-xs mt-1">Try adjusting your search or filters</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {filteredPersons.map((person, idx) => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      idx={idx}
                      onClick={() => setSelectedPerson(person)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="shrink-0 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Showing {filteredPersons.length} of {persons.length} records</span>
              <span className="font-mono">Page 1 of 1</span>
            </div>
          </TabsContent>

          {/* ═══════════════ IDENTIFIED TAB ═══════════════ */}
          <TabsContent value="identified" className="h-full m-0 flex flex-col gap-4">
            <div className="shrink-0 flex items-center justify-between bg-zinc-900/30 px-3 py-2 rounded-lg border border-white/5">
              <div className="flex items-center gap-4 text-[10px]">
                <span className="text-muted-foreground">Global IDs: <span className="text-white font-semibold">{globalIdentities.length}</span></span>
                <span className="text-muted-foreground">Known: <span className="text-emerald-400 font-semibold">{globalIdentities.filter(g => !!g.associatedPersonId).length}</span></span>
                <span className="text-muted-foreground">Unknown: <span className="text-amber-400 font-semibold">{globalIdentities.filter(g => !g.associatedPersonId).length}</span></span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[9px] border-white/10 text-muted-foreground" onClick={fetchGlobalIdentities} disabled={loadingGlobalIdentities}>
                {loadingGlobalIdentities ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Refresh
              </Button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
              <Card className="flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden min-h-0">
                <div className="px-3 py-2.5 border-b border-white/5">
                  <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Global Identities</h3>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Cross-camera ReID clusters</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {globalIdentities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40">
                      <UserCheck className="h-8 w-8 mb-2" />
                      <p className="text-[10px] font-medium">No global identities yet</p>
                    </div>
                  ) : globalIdentities.map((gid) => {
                    const isSelected = selectedGlobalIdentity?.globalIdentityId === gid.globalIdentityId;
                    const name = gid.associatedPerson?.name || gid.associatedPersonId || 'Unknown Cluster';
                    const lastSeen = gid.lastSeenTimestamp ? new Date(gid.lastSeenTimestamp).toLocaleString() : 'N/A';
                    return (
                      <button
                        key={gid.globalIdentityId}
                        className={cn(
                          "w-full text-left p-2 rounded-lg border transition-all",
                          isSelected ? "border-primary/50 bg-primary/10" : "border-white/5 hover:bg-white/[0.03]"
                        )}
                        onClick={() => setSelectedGlobalIdentity(gid)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-white truncate">{name}</p>
                          <Badge className={cn("h-4 px-1 text-[7px] border-0", gid.associatedPersonId ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
                            {gid.associatedPersonId ? 'KNOWN' : 'UNKNOWN'}
                          </Badge>
                        </div>
                        <p className="text-[8px] text-muted-foreground mt-0.5 font-mono truncate">{gid.globalIdentityId}</p>
                        <p className="text-[8px] text-muted-foreground mt-0.5 truncate">Last seen: {lastSeen}</p>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <div className="flex flex-col min-h-0 gap-3">
                <Card className="shrink-0 border border-white/5 bg-zinc-900/30 p-3">
                  {selectedGlobalIdentity ? (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                        <p className="text-[8px] text-muted-foreground uppercase">Identity</p>
                        <p className="text-[10px] text-white font-mono truncate mt-1">{selectedGlobalIdentity.globalIdentityId}</p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                        <p className="text-[8px] text-muted-foreground uppercase">Person</p>
                        <p className="text-[10px] text-white truncate mt-1">{selectedGlobalIdentity.associatedPerson?.name || 'Unknown Cluster'}</p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                        <p className="text-[8px] text-muted-foreground uppercase">First Seen</p>
                        <p className="text-[10px] text-white truncate mt-1">{new Date(selectedGlobalIdentity.firstSeenTimestamp).toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                        <p className="text-[8px] text-muted-foreground uppercase">Last Seen</p>
                        <p className="text-[10px] text-white truncate mt-1">{new Date(selectedGlobalIdentity.lastSeenTimestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">Select a global identity to view timeline.</div>
                  )}
                </Card>

                <Card className="flex-1 border border-white/5 bg-zinc-900/30 overflow-hidden min-h-0">
                  <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Timeline Detections</h3>
                    <span className="text-[9px] text-muted-foreground">{globalTimeline.length} events</span>
                  </div>
                  <div className="h-full overflow-y-auto p-2 space-y-1">
                    {loadingGlobalTimeline ? (
                      <div className="py-10 text-center text-[10px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />Loading timeline...</div>
                    ) : globalTimeline.length === 0 ? (
                      <div className="py-10 text-center text-[10px] text-muted-foreground">No detections for this identity yet.</div>
                    ) : globalTimeline.map((det) => (
                      <div key={det.id} className="flex gap-2 p-2 rounded-lg border border-white/5 bg-black/20">
                        <div className="h-12 w-16 rounded overflow-hidden border border-white/10 bg-black shrink-0">
                          <img src={det.faceSnapshotUrl || det.metadata?.images?.['face_crop.jpg'] || det.fullSnapshotUrl || det.metadata?.images?.['frame.jpg']} className="w-full h-full object-cover" alt="" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] text-white font-semibold truncate">{det.device?.name || det.deviceId}</p>
                            <Badge className="h-4 px-1 text-[7px] bg-blue-500/20 text-blue-400 border-0">{Math.round((det.confidence || 0) * 100)}%</Badge>
                          </div>
                          <p className="text-[8px] text-muted-foreground mt-0.5">{new Date(det.timestamp).toLocaleString()}</p>
                          <p className="text-[8px] text-muted-foreground mt-0.5 truncate font-mono">event #{det.id}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════ SEARCH TAB ═══════════════ */}
          <TabsContent value="search" className="h-full m-0 flex flex-col lg:flex-row gap-4">
            {/* Search Form Panel */}
            <Card className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden max-h-[400px] lg:max-h-none">
              <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                  <ScanFace className="h-4 w-4 text-primary" />
                  Biometric Search
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Upload image and enter person details</p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Image Upload */}
                <div
                  onClick={() => document.getElementById('search-upload')?.click()}
                  className={cn(
                    "border border-dashed rounded-lg p-3 text-center cursor-pointer transition-all relative overflow-hidden",
                    "hover:bg-white/[0.02]",
                    searchPreview ? "border-primary/30 h-36" : "border-white/10 h-28"
                  )}
                >
                  {searchPreview ? (
                    <img src={searchPreview} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" />
                  ) : null}
                  <div className="relative z-10 h-full flex flex-col items-center justify-center">
                    {!searchPreview && <Upload className="h-5 w-5 mb-1.5 text-muted-foreground" />}
                    <p className="text-[10px] text-muted-foreground">{searchFile ? searchFile.name : 'Select facial image'}</p>
                    <Button size="sm" variant="outline" className="mt-2 h-6 text-[9px] border-white/10">
                      {searchFile ? 'Change' : 'Browse'}
                    </Button>
                  </div>
                  <input id="search-upload" type="file" className="hidden" accept="image/*" onChange={handleSearchImageChange} />
                </div>

                {/* Form Fields */}
                <div className="space-y-2.5">
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name <span className="text-red-500">*</span></Label>
                    <Input
                      ref={searchNameInputRef}
                      value={searchForm.name}
                      onChange={(e) => setSearchForm({ ...searchForm, name: e.target.value })}
                      placeholder="Full name"
                      className="h-8 mt-1 bg-black/30 border-white/10 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Age</Label>
                      <Input
                        value={searchForm.age}
                        onChange={(e) => setSearchForm({ ...searchForm, age: e.target.value })}
                        placeholder="Age"
                        className="h-8 mt-1 bg-black/30 border-white/10 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Gender</Label>
                      <select
                        value={searchForm.gender}
                        onChange={(e) => setSearchForm({ ...searchForm, gender: e.target.value })}
                        className="flex h-8 w-full mt-1 rounded-md border border-white/10 bg-black/30 px-2 text-xs text-white"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Threat Level</Label>
                      <select
                        value={searchForm.threatLevel}
                        onChange={(e) => setSearchForm({ ...searchForm, threatLevel: e.target.value })}
                        className="flex h-8 w-full mt-1 rounded-md border border-white/10 bg-black/30 px-2 text-xs text-white"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                      <select
                        value={searchForm.status}
                        onChange={(e) => setSearchForm({ ...searchForm, status: e.target.value })}
                        className="flex h-8 w-full mt-1 rounded-md border border-white/10 bg-black/30 px-2 text-xs text-white"
                      >
                        <option value="wanted">Wanted</option>
                        <option value="vip">VIP</option>
                        <option value="staff">Staff</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Height</Label>
                      <Input
                        value={searchForm.height}
                        onChange={(e) => setSearchForm({ ...searchForm, height: e.target.value })}
                        placeholder="5'8"
                        className="h-8 mt-1 bg-black/30 border-white/10 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Aliases</Label>
                      <Input
                        value={searchForm.aliases}
                        onChange={(e) => setSearchForm({ ...searchForm, aliases: e.target.value })}
                        placeholder="Comma separated"
                        className="h-8 mt-1 bg-black/30 border-white/10 text-xs"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleSearchSubmit}
                  disabled={searchLoading}
                  className="w-full bg-primary hover:bg-primary/90 text-white h-9 font-semibold text-xs"
                >
                  {searchLoading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-2" />}
                  Begin Search
                </Button>
              </div>
            </Card>

            {/* Results Panel */}
            <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-white/5 bg-zinc-900/20 overflow-hidden">
              {searchResults.length > 0 ? (
                <div className="flex-1 overflow-y-auto p-4 lg:p-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="text-xs font-semibold text-white">Search Results</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Identity matches confirmed</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSearchResults([])} className="h-7 text-[10px] text-muted-foreground hover:text-white">
                      Clear
                    </Button>
                  </div>

                  {searchResults.map((result: any) => (
                    <div key={result.id} className="flex flex-col lg:flex-row gap-6 bg-white/[0.02] p-4 lg:p-6 rounded-xl border border-white/5">
                      <div className="shrink-0 w-full lg:w-48">
                        <div className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-black">
                          <img src={result.faceImageUrl} className="w-full h-full object-cover" alt="" />
                        </div>
                        <div className="flex gap-1.5 justify-center mt-3">
                          <Badge className="bg-emerald-500/20 text-emerald-400 text-[9px] font-semibold border-0">INDEXED</Badge>
                          <CategoryBadge category={result.category} />
                        </div>
                      </div>

                      <div className="flex-1 space-y-4 min-w-0">
                        <div>
                          <h2 className="text-lg font-bold text-white">{result.name}</h2>
                          <p className="text-xs text-muted-foreground mt-0.5">ID: <span className="font-mono">{result.id?.slice(0, 12)}</span></p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {[
                            ['Age', result.age || '?'],
                            ['Gender', result.gender || '?'],
                            ['Height', result.height || '?'],
                            ['Status', result.status || result.category],
                            ['Risk', result.threatLevel || 'Medium'],
                            ['Aliases', result.aliases || 'None'],
                          ].map(([label, value]) => (
                            <div key={label} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
                              <p className="text-xs text-white mt-0.5 font-medium">{value}</p>
                            </div>
                          ))}
                        </div>

                        {result.notes && (
                          <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Notes</p>
                            <p className="text-xs text-white/80 mt-0.5">{result.notes}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/20"
                            onClick={() => { setSelectedPerson(result); setActiveTab('watchlist'); }}
                          >
                            View in Watchlist
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <div className="relative w-32 h-32 mb-6 flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-white/5 rounded-full animate-[spin_10s_linear_infinite]" />
                    <div className="absolute inset-3 border border-primary/20 rounded-full animate-[spin_3s_linear_infinite_reverse]" />
                    <div className="absolute inset-6 border-l-2 border-t-2 border-primary/40 rounded-full animate-[spin_2s_linear_infinite]" />
                    <ScanFace className="w-10 h-10 text-primary/60" />
                  </div>
                  <h3 className="text-sm font-semibold text-white/80 tracking-wide">Awaiting Search</h3>
                  <p className="text-[10px] text-muted-foreground mt-1.5 max-w-xs">
                    Upload an image and fill in person details to begin facial recognition search
                  </p>
                </div>
              )}
            </div>

            {/* Faces In Use */}
            <Card className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden max-h-[400px] lg:max-h-none">
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-emerald-400" />
                  Faces In Use
                </h3>
                <span className="text-[10px] text-muted-foreground">{persons.length} total</span>
              </div>
              <div className="p-3 overflow-y-auto">
                {persons.length === 0 ? (
                  <div className="py-10 text-center text-[10px] text-muted-foreground/60">
                    No faces enrolled yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {persons.map((person) => (
                      <div
                        key={person.id}
                        className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-2 cursor-pointer hover:border-white/20 hover:bg-white/[0.03]"
                        onClick={() => openEditPerson(person)}
                      >
                        <div className="h-12 w-12 rounded-md overflow-hidden bg-black border border-white/10 shrink-0">
                          <img src={person.faceImageUrl} className="w-full h-full object-cover" alt="" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-white font-semibold truncate">{person.name}</p>
                          <p className="text-[8px] text-muted-foreground truncate">ID: {person.id?.slice(0, 12)}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <CategoryBadge category={person.category} />
                            <ThreatBadge level={person.threatLevel} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* ═══════════════ PERSON EDIT MODAL ═══════════════ */}
          <Dialog open={showPersonEditModal} onOpenChange={setShowPersonEditModal}>
            <DialogContent className="max-w-2xl border border-white/5 bg-zinc-900/95 backdrop-blur-xl p-0 gap-0 overflow-hidden">
              <DialogHeader className="px-6 pt-5">
                <DialogTitle className="text-lg font-semibold text-zinc-100">Edit Person</DialogTitle>
                <DialogDescription className="text-xs text-zinc-500 mt-1">Update details and save to the database.</DialogDescription>
              </DialogHeader>
              <div className="px-6 pb-6 pt-4 space-y-4">
                <div className="flex gap-4">
                  <div className="w-28 shrink-0">
                    <div className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-black">
                      <img src={editPreviews[0] || editPerson?.faceImageUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                    <Label className="mt-2 text-[10px] text-muted-foreground block">Add Images</Label>
                    <input
                      id="edit-image-upload"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleEditImageChange}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full mt-1 h-7 text-[10px] border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      onClick={() => document.getElementById('edit-image-upload')?.click()}
                    >
                      <Upload className="h-3 w-3 mr-1.5" />
                      {editFiles.length > 0 ? `${editFiles.length} Selected` : 'Choose Files'}
                    </Button>

                    {/* Image Previews */}
                    {editPreviews.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {editPreviews.map((preview, idx) => (
                          <div key={idx} className="aspect-square rounded overflow-hidden border border-white/10 bg-black relative group">
                            <img src={preview} className="w-full h-full object-cover" alt="" />
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                setEditFiles(prev => prev.filter((_, i) => i !== idx));
                                setEditPreviews(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-0.5 right-0.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</Label>
                      <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Age</Label>
                      <Input value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Gender</Label>
                      <Input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Threat Level</Label>
                      <Input value={editForm.threatLevel} onChange={(e) => setEditForm({ ...editForm, threatLevel: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                      <Input value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Height</Label>
                      <Input value={editForm.height} onChange={(e) => setEditForm({ ...editForm, height: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Aliases</Label>
                      <Input value={editForm.aliases} onChange={(e) => setEditForm({ ...editForm, aliases: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Category</Label>
                      <Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Notes</Label>
                  <Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="h-8 mt-1 bg-black/30 border-white/10 text-xs" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1 h-9 text-xs border-white/10 text-zinc-300 hover:bg-zinc-800" onClick={() => setShowPersonEditModal(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" className="flex-1 h-9 text-xs bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-500" onClick={handleEditSave} disabled={editSaving}>
                    {editSaving ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* ═══════════════ ALERTS TAB ═══════════════ */}
          <TabsContent value="alerts" className="h-full m-0 flex flex-col gap-4">
            {/* Toolbar */}
            <div className="shrink-0 flex items-center justify-between bg-zinc-900/30 px-3 py-2 rounded-lg border border-white/5">
              <div className="flex items-center gap-4 text-[10px]">
                <span className="text-muted-foreground">Total: <span className="text-white font-semibold">{alerts.length || 0}</span></span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-400 font-medium">Auto-Refresh</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[9px] border-white/10 text-muted-foreground"
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  {isExporting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[9px] border-white/10 text-muted-foreground" onClick={handleRefresh}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </div>
            </div>

            {/* 3-Column Alert Layout */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_340px_1fr] gap-3">
              {/* Alert List */}
              <Card className="flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden min-h-0">
                <div className="px-3 py-2.5 border-b border-white/5">
                  <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Recent Alerts</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {alerts.length > 0 ? alerts.filter(Boolean).map((alert) => {
                    const isSelected = selectedAlert?.id === alert.id;
                    const personId = alert.metadata?.person_id;
                    const matchedPerson = personId ? persons.find(p => String(p.id) === String(personId)) : null;

                    // If personId exists, treat as known (unless explicitly marked otherwise)
                    // If no personId, it's definitely unknown even if is_known isn't false
                    const isKnown = alert.metadata?.is_known !== false && !!personId;

                    const displayName = isKnown ? (matchedPerson?.name || alert.metadata?.person_name || alert.title) : "Unknown Subject";
                    const borderColor = isKnown ? (matchedPerson?.threatLevel === 'High' ? 'border-red-500/50' : 'border-emerald-500/50') : 'border-zinc-700';
                    const bgColor = isKnown ? (matchedPerson?.threatLevel === 'High' ? 'bg-red-500/10' : 'bg-emerald-500/5') : 'bg-zinc-800/40';

                    return (
                      <div
                        key={alert.id}
                        onClick={() => setSelectedAlert(alert)}
                        className={cn(
                          "flex gap-2 p-2 rounded-lg cursor-pointer transition-all border",
                          isSelected ? "border-primary/50 bg-primary/10" : `${borderColor} ${bgColor} hover:bg-white/[0.05]`
                        )}
                      >
                        <div className="h-10 w-16 flex rounded overflow-hidden border border-white/10 shrink-0">
                          <div className="w-1/2 h-full bg-black border-r border-white/5 relative flex items-center justify-center">
                            {isKnown ? (
                              <img src={matchedPerson?.faceImageUrl || alert.metadata?.images?.['face.jpg']} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Users className="h-4 w-4 text-muted-foreground/50" />
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[5px] text-center text-white/80 font-bold uppercase">{isKnown ? 'Ref' : '---'}</div>
                          </div>
                          <div className="w-1/2 h-full bg-black relative">
                            <img src={alert.metadata?.images?.['face.jpg'] || alert.metadata?.images?.['frame.jpg']} className="w-full h-full object-cover" alt="" />
                            <div className="absolute inset-x-0 bottom-0 iris-cut-tag-base iris-cut-tag-default text-[5px] text-center text-white font-bold uppercase">Live</div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[10px] text-white truncate">{normalizeAlertTitle(displayName)}</p>
                          <p className="text-[8px] text-muted-foreground truncate">{alert.deviceId || 'Primary Node'}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge className="h-3.5 px-1 text-[7px] bg-emerald-500/20 text-emerald-400 border-0 font-bold">
                              {Math.round((alert.metadata?.confidence || 0.85) * 100)}%
                            </Badge>
                            <span className="text-[7px] text-muted-foreground">{new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground/30 text-[10px]">
                      No alerts
                    </div>
                  )}
                </div>
              </Card>

              {/* Subject Profile - Hidden on mobile, visible on xl */}
              <Card className="hidden xl:flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden min-h-0">
                <div className="px-3 py-2.5 border-b border-white/5">
                  <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Subject Profile</h3>
                </div>
                {selectedAlert ? (() => {
                  const personId = selectedAlert.metadata?.person_id;
                  const matchedPerson = persons.find(p => p.id === personId);
                  return (
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      <div className="w-full aspect-square rounded-lg overflow-hidden border border-white/10 bg-black relative">
                        {matchedPerson?.faceImageUrl ? (
                          <img src={matchedPerson.faceImageUrl} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/20">
                            <Users className="h-12 w-12 mb-2" />
                            <p className="text-[9px] uppercase font-medium">No Photo</p>
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <Badge className="bg-black/60 backdrop-blur text-[8px] text-primary border-0">REFERENCE</Badge>
                        </div>
                      </div>

                      <div className="text-center">
                        <h2 className="text-base font-bold text-white">{matchedPerson?.name || 'Unknown Subject'}</h2>
                        <div className="flex gap-1.5 justify-center mt-2">
                          <ThreatBadge level={matchedPerson?.threatLevel} />
                          <CategoryBadge category={matchedPerson?.category} />
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                        {[
                          ['Subject ID', matchedPerson?.id?.slice(0, 12) || 'N/A'],
                          ['Age', formatMetadata(matchedPerson?.age || selectedAlert.metadata?.ageGroup || selectedAlert.metadata?.age_group)],
                          ['Gender', formatMetadata(matchedPerson?.gender || selectedAlert.metadata?.gender)],
                        ].map(([label, value]) => (
                          <div key={label} className="p-2 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[8px] text-muted-foreground uppercase tracking-wider">{label}</p>
                            <p className="text-xs text-white mt-0.5">{value}</p>
                          </div>
                        ))}
                      </div>

                      <Separator className="bg-white/5" />
                      <div className="space-y-1.5">
                        <h4 className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Detection</h4>
                        {[
                          ['Confidence', `${Math.round((selectedAlert.metadata?.confidence || 0.85) * 100)}%`],
                          ['Timestamp', new Date(selectedAlert.timestamp).toLocaleString()],
                          ['Source', selectedAlert.deviceId || 'Primary Node'],
                          ['Track ID', selectedAlert.metadata?.track_id || 'N/A'],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-white font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground/30 p-4">
                    <p className="text-[10px]">Select an alert to view details</p>
                  </div>
                )}
              </Card>

              {/* Surveillance View */}
              <div className="flex flex-col min-h-0 gap-3">
                <Card className="flex-1 overflow-hidden border border-white/5 bg-black relative min-h-[200px]">
                  {selectedAlert ? (
                    <>
                      <img
                        src={selectedAlert.metadata?.fullImageUrl || selectedAlert.metadata?.images?.['face.jpg'] || selectedAlert.metadata?.images?.['frame.jpg']}
                        className={cn(
                          "w-full h-full object-cover transition-all duration-700",
                          (selectedAlert.metadata?.face_box || selectedAlert.metadata?.box || selectedAlert.metadata?.bounding_box) ? "scale-150" : ""
                        )}
                        style={(selectedAlert.metadata?.face_box || selectedAlert.metadata?.box || selectedAlert.metadata?.bounding_box) ? {
                          objectPosition: (() => {
                            const box = selectedAlert.metadata.face_box || selectedAlert.metadata.box || selectedAlert.metadata.bounding_box;
                            if (Array.isArray(box) && box.length === 4) {
                              const centerY = (box[0] + box[2]) / 2 * 100;
                              const centerX = (box[1] + box[3]) / 2 * 100;
                              return `${centerX}% ${centerY}%`;
                            }
                            return 'center';
                          })()
                        } : undefined}
                        alt=""
                      />
                      <div className="absolute top-3 right-3 flex flex-col gap-1.5 items-end">
                        <Badge className="bg-black/70 backdrop-blur text-white text-[9px] px-2 py-0.5 font-mono border-0">
                          {new Date(selectedAlert.timestamp).toLocaleString()}
                        </Badge>
                        <Badge className="bg-emerald-600/90 text-white text-[9px] px-2 py-0.5 font-bold border-0">
                          {Math.round((selectedAlert.metadata?.confidence || 0.85) * 100)}% MATCH
                        </Badge>
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <Badge className="bg-black/60 backdrop-blur text-primary text-[9px] px-2 py-0.5 border-0 font-medium">
                          <Activity className="h-3 w-3 mr-1 animate-pulse" /> {selectedAlert.deviceId || 'Primary Feed'}
                        </Badge>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/20">
                      <div className="text-center">
                        <Monitor className="h-12 w-12 mx-auto mb-3 opacity-20" />
                        <p className="text-[10px]">No surveillance feed</p>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Detection Metadata */}
                <Card className="shrink-0 border border-white/5 bg-zinc-900/30">
                  <div className="px-3 py-2 border-b border-white/5">
                    <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Detection Metadata</h3>
                  </div>
                  <div className="p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                    {[
                      ['Est. Age', formatMetadata(selectedAlert?.metadata?.ageGroup || selectedAlert?.metadata?.age_group)],
                      ['Gender', formatMetadata(selectedAlert?.metadata?.gender)],
                      ['Mask', selectedAlert?.metadata?.mask === 'yes' ? 'Detected' : 'None'],
                      ['Face Quality', `${Math.round((selectedAlert?.metadata?.quality_score || 0.72) * 100)}%`],
                      ['Track ID', selectedAlert?.metadata?.track_id || 'N/A'],
                      ['Quality', selectedAlert?.metadata?.quality_score?.toFixed(2) || 'N/A'],
                    ].map(([label, value]) => (
                      <div key={label} className="p-2 rounded-lg bg-white/[0.03] border border-white/5">
                        <p className="text-[8px] text-muted-foreground uppercase">{label}</p>
                        <p className="text-[10px] text-white mt-0.5 font-medium">{value}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════ UNKNOWN FACES TAB ═══════════════ */}
          <TabsContent value="unknown" className="h-full m-0 flex flex-col gap-4">
            {/* Toolbar */}
            <div className="shrink-0 flex items-center justify-between bg-zinc-900/30 px-3 py-2 rounded-lg border border-white/5">
              <div className="flex items-center gap-4 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <UserX className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-white font-semibold">Unknown Faces</span>
                </div>
                <span className="text-muted-foreground">Total: <span className="text-white font-semibold">{unknownFaces.length}</span></span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-400 font-medium">Auto-Refresh</span>
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[9px] border-white/10 text-muted-foreground" onClick={fetchUnknownFaces} disabled={loadingUnknown}>
                {loadingUnknown ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Refresh
              </Button>
            </div>

            {/* Content: List + Detail Split */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
              {/* Face List */}
              <Card className="flex flex-col border border-white/5 bg-zinc-900/30 overflow-hidden min-h-0">
                <div className="px-3 py-2.5 border-b border-white/5">
                  <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Detected Faces</h3>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Faces not matching any watchlist entry</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {unknownFaces.length > 0 ? unknownFaces.map((face) => {
                    const isSelected = selectedUnknown?.id === face.id;
                    const faceImg = face.faceSnapshotUrl || face.metadata?.images?.['face_crop.jpg'] || face.metadata?.images?.['frame.jpg'];
                    const cropImg = face.metadata?.images?.['face_crop.jpg'] || face.faceSnapshotUrl;

                    return (
                      <div
                        key={face.id}
                        onClick={() => setSelectedUnknown(face)}
                        className={cn(
                          "flex gap-2.5 p-2 rounded-lg cursor-pointer transition-all border",
                          isSelected ? "border-amber-500/30 bg-amber-500/5" : "border-transparent hover:bg-white/[0.03]"
                        )}
                      >
                        <div className="h-11 w-11 rounded-md overflow-hidden border border-white/10 bg-black shrink-0">
                          <img src={cropImg || faceImg} className="w-full h-full object-cover" alt="" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-[10px] text-white truncate">Unknown Person</p>
                            <span className="text-[8px] font-mono text-muted-foreground shrink-0">#{face.id}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <Badge className="h-3.5 px-1 text-[7px] bg-amber-500/20 text-amber-400 border-0 font-bold">
                              {Math.round((face.confidence || 0) * 100)}% conf
                            </Badge>
                            {face.metadata?.gender && (
                              <Badge className="h-3.5 px-1 text-[7px] bg-white/5 text-muted-foreground border-0">
                                {formatMetadata(face.metadata.gender)}
                              </Badge>
                            )}
                            {face.metadata?.ageGroup && (
                              <Badge className="h-3.5 px-1 text-[7px] bg-white/5 text-muted-foreground border-0">
                                {formatMetadata(face.metadata.ageGroup)}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[8px] text-muted-foreground truncate mt-0.5">
                            {new Date(face.timestamp).toLocaleTimeString()}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-5 text-[8px] mt-1 w-full border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedUnknownForConversion(face);
                              setShowConvertUnknownDialog(true);
                            }}
                          >
                            <UserCheck className="h-2.5 w-2.5 mr-1" />
                            Mark as Known
                          </Button>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40">
                      <UserX className="h-8 w-8 mb-2" />
                      <p className="text-[10px] font-medium">No unknown faces detected</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Detail View */}
              <div className="flex flex-col min-h-0 gap-3">
                <Card className="flex-1 overflow-hidden border border-white/5 bg-black relative min-h-[200px]">
                  {selectedUnknown ? (
                    <>
                      <img
                        src={selectedUnknown.faceSnapshotUrl || selectedUnknown.metadata?.images?.['face_crop.jpg'] || selectedUnknown.metadata?.images?.['frame.jpg']}
                        className="w-full h-full object-cover"
                        alt=""
                      />
                      <div className="absolute top-3 right-3 flex flex-col gap-1.5 items-end">
                        <Badge className="bg-black/70 backdrop-blur text-white text-[9px] px-2 py-0.5 font-mono border-0">
                          {new Date(selectedUnknown.timestamp).toLocaleString()}
                        </Badge>
                        <Badge className="bg-amber-600/90 text-white text-[9px] px-2 py-0.5 font-bold border-0">
                          UNKNOWN
                        </Badge>
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <Badge className="bg-black/60 backdrop-blur text-amber-400 text-[9px] px-2 py-0.5 border-0 font-medium">
                          <Camera className="h-3 w-3 mr-1" /> {selectedUnknown.device?.name || selectedUnknown.deviceId || 'Unknown Source'}
                        </Badge>
                      </div>
                      {/* Face crop overlay */}
                      {selectedUnknown.metadata?.images?.['face_crop.jpg'] && (
                        <div className="absolute top-3 left-3">
                          <div className="h-16 w-16 rounded-lg overflow-hidden border-2 border-amber-500/50 bg-black shadow-lg">
                            <img src={selectedUnknown.metadata.images['face_crop.jpg']} className="w-full h-full object-cover" alt="" />
                          </div>
                          <p className="text-[7px] text-amber-400 font-bold mt-1 text-center">FACE CROP</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/20">
                      <div className="text-center">
                        <UserX className="h-12 w-12 mx-auto mb-3 opacity-20" />
                        <p className="text-[10px]">Select a face to view details</p>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Metadata */}
                <Card className="shrink-0 border border-white/5 bg-zinc-900/30">
                  <div className="px-3 py-2 border-b border-white/5">
                    <h3 className="text-[10px] font-semibold text-white uppercase tracking-wider">Detection Metadata</h3>
                  </div>
                  <div className="p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                    {[
                      ['Est. Age', formatMetadata(selectedUnknown?.metadata?.ageGroup || selectedUnknown?.metadata?.age_group)],
                      ['Gender', formatMetadata(selectedUnknown?.metadata?.gender)],
                      ['Confidence', selectedUnknown ? `${Math.round((selectedUnknown.confidence || 0) * 100)}%` : 'N/A'],
                      ['Face Quality', selectedUnknown?.metadata?.quality_score ? `${Math.round(selectedUnknown.metadata.quality_score * 100)}%` : 'N/A'],
                      ['Source', selectedUnknown?.device?.name || selectedUnknown?.deviceId || 'N/A'],
                      ['Detection', selectedUnknown?.metadata?.detection_reason || 'N/A'],
                    ].map(([label, value]) => (
                      <div key={label} className="p-2 rounded-lg bg-white/[0.03] border border-white/5">
                        <p className="text-[8px] text-muted-foreground uppercase">{label}</p>
                        <p className="text-[10px] text-white mt-0.5 font-medium">{value}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* ═══════════════ MATCH DETAILS MODAL ═══════════════ */}
      <Dialog open={showMatchModal} onOpenChange={setShowMatchModal}>
        <DialogContent className="max-w-5xl border border-white/5 bg-zinc-900/95 backdrop-blur-xl p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Face Match Details</DialogTitle>
            <DialogDescription>Match confidence and person details</DialogDescription>
          </DialogHeader>
          {selectedMatch && (() => {
            const matchPerson = persons.find(p =>
              p.id === (selectedMatch as any).person?.id ||
              p.id === (selectedMatch as any).personId ||
              p.id === selectedMatch.metadata?.person_id
            );
            const confidence = Math.round((selectedMatch.metadata?.confidence || 0) * 100);
            return (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] border-b border-white/5">
                  {/* Left panel: reference + metadata */}
                  <div className="p-4 border-b lg:border-b-0 lg:border-r border-white/5 space-y-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-2 uppercase tracking-wider">Reference</p>
                      <div className="aspect-square rounded-lg overflow-hidden bg-black border border-white/5">
                        {matchPerson?.faceImageUrl || (selectedMatch as any).person?.faceImageUrl ? (
                          <img src={matchPerson?.faceImageUrl || (selectedMatch as any).person?.faceImageUrl} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-700"><Users className="h-10 w-10" /></div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/5 bg-black/20 divide-y divide-white/5">
                      {[
                        ['Source Node', (selectedMatch as any).device?.name || selectedMatch.deviceId || 'Primary Node'],
                        ['Track ID', (selectedMatch as any).metadata?.track_id || (selectedMatch as any).metadata?.trackId || selectedMatch.id || 'N/A'],
                        ['Age', formatMetadata(matchPerson?.age || (selectedMatch as any).person?.age || selectedMatch.metadata?.ageGroup || selectedMatch.metadata?.age_group)],
                        ['Gender', formatMetadata(matchPerson?.gender || (selectedMatch as any).person?.gender || selectedMatch.metadata?.gender)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between px-3 py-2">
                          <span className="text-[10px] text-zinc-500">{label}</span>
                          <span className="text-[10px] text-zinc-200 font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right panel: live capture */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-100">
                          {normalizeAlertTitle(matchPerson?.name || (selectedMatch as any).person?.name || selectedMatch.metadata?.person_name || selectedMatch.title)}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1">
                          {new Date(selectedMatch.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-zinc-100 tabular-nums">{confidence}%</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Match</p>
                      </div>
                    </div>

                    <div className="relative rounded-xl overflow-hidden bg-black border border-white/5">
                      <img
                        src={selectedMatch.metadata?.images?.['face.jpg'] || selectedMatch.metadata?.images?.['frame.jpg']}
                        className="w-full h-[45vh] max-h-[520px] object-contain bg-black"
                        alt=""
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-white/5 space-y-3">
                  {/* Multi-Image Upload Section */}
                  {matchPerson && (
                    <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="text-xs font-semibold text-white">Add to Gallery</h4>
                          <p className="text-[9px] text-muted-foreground mt-0.5">Upload additional images to improve matching accuracy</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <input
                          id="match-modal-upload"
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleMatchModalImageChange}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                          onClick={() => document.getElementById('match-modal-upload')?.click()}
                        >
                          <Upload className="h-3 w-3 mr-1.5" />
                          {matchModalFiles.length > 0 ? `${matchModalFiles.length} Selected` : 'Choose Images'}
                        </Button>

                        {matchModalFiles.length > 0 && (
                          <Button
                            size="sm"
                            className="h-8 text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white"
                            onClick={handleMatchModalAddToGallery}
                            disabled={isAddingToGallery}
                          >
                            {isAddingToGallery ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                Adding...
                              </>
                            ) : (
                              <>
                                <Plus className="h-3 w-3 mr-1.5" />
                                Add to Gallery
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Image Previews */}
                      {matchModalPreviews.length > 0 && (
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {matchModalPreviews.map((preview, idx) => (
                            <div key={idx} className="aspect-square rounded overflow-hidden border border-white/10 bg-black relative group">
                              <img src={preview} className="w-full h-full object-cover" alt="" />
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  setMatchModalFiles(prev => prev.filter((_, i) => i !== idx));
                                  setMatchModalPreviews(prev => prev.filter((_, i) => i !== idx));
                                }}
                                className="absolute top-0.5 right-0.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs border-white/10 text-zinc-300 hover:bg-zinc-800"
                      onClick={() => setShowMatchModal(false)}
                    >
                      Close
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-9 text-xs bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-500"
                      onClick={() => {
                        if (matchPerson) {
                          setSelectedPerson(matchPerson);
                          setActiveTab('watchlist');
                          setShowMatchModal(false);
                        } else {
                          toast({ title: "No Profile", description: "Person not in registry.", variant: "destructive" });
                        }
                      }}
                    >
                      View Profile
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ═══════════════ PERSON PROFILE MODAL ═══════════════ */}
      <Dialog open={!!selectedPerson} onOpenChange={(open) => !open && setSelectedPerson(null)}>
        <DialogContent className="max-w-4xl border border-white/5 bg-zinc-900/95 backdrop-blur-xl p-0 gap-0 overflow-hidden max-h-[85vh]">
          <DialogHeader className="sr-only">
            <DialogTitle>Person Profile</DialogTitle>
            <DialogDescription>Profile details and match history</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col lg:flex-row h-full max-h-[85vh]">
            {/* Left Panel - Profile */}
            <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 flex flex-col overflow-y-auto">
              {/* Photo */}
              <div className="aspect-square relative bg-black shrink-0">
                <img src={selectedPerson?.faceImageUrl} className="w-full h-full object-cover" alt="" />
              </div>

              {/* Info */}
              <div className="p-4 space-y-4 flex-1">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">{selectedPerson?.name}</h2>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5">{selectedPerson?.id?.slice(0, 12)}</p>
                </div>

                <div className="rounded-lg border border-white/5 bg-black/20 divide-y divide-white/5">
                  {[
                    ['Category', selectedPerson?.category === 'Warrant' ? 'Wanted' : selectedPerson?.category || 'N/A'],
                    ['Threat', selectedPerson?.threatLevel || 'Medium'],
                    ['Age', selectedPerson?.age || '—'],
                    ['Gender', selectedPerson?.gender || '—'],
                    ['Height', selectedPerson?.height || '—'],
                    ['Status', selectedPerson?.status || selectedPerson?.category || '—'],
                    ['Aliases', selectedPerson?.aliases || 'None'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-zinc-500">{label}</span>
                      <span className={cn(
                        "text-xs font-medium",
                        label === 'Threat' && String(value).toLowerCase() === 'high' ? "text-red-400" :
                          label === 'Threat' && String(value).toLowerCase() === 'medium' ? "text-amber-400" :
                            "text-zinc-200"
                      )}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Image Gallery Section */}
                <div className="border-t border-white/5 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-white">
                      Image Gallery
                      {personGalleryImages.length > 0 && (
                        <Badge className="ml-2 h-4 text-[8px] bg-blue-500/20 text-blue-400 border-0">
                          {personGalleryImages.length}
                        </Badge>
                      )}
                    </h3>
                  </div>

                  {loadingGallery ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : personGalleryImages.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {personGalleryImages.map((img, idx) => (
                        <div key={idx} className="aspect-square rounded overflow-hidden border border-white/10 bg-black">
                          <img src={img} className="w-full h-full object-cover" alt="" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-[10px] text-muted-foreground">
                      <p>No additional images</p>
                      <p className="mt-1">Use "Add to Gallery" to upload more</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8 text-xs border-white/10 text-zinc-400 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/5"
                    onClick={(e) => { if (selectedPerson) handleDeletePerson(selectedPerson.id, e); }}
                  >
                    <Trash className="h-3 w-3 mr-1.5" /> Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8 text-xs border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    onClick={() => selectedPerson && openEditPerson(selectedPerson)}
                  >
                    <Edit className="h-3 w-3 mr-1.5" /> Edit
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Panel - Detections */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Latest Surveillance Frame */}
              <div className="h-44 lg:h-[42%] shrink-0 relative bg-black border-b border-white/5">
                {personHistory.length > 0 ? (
                  <>
                    <img
                      src={personHistory[0].metadata?.images?.['face.jpg'] || personHistory[0].metadata?.images?.['frame.jpg']}
                      className="w-full h-full object-cover"
                      alt=""
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-2">
                      <span className="bg-black/70 backdrop-blur-sm text-zinc-300 text-[10px] px-2 py-0.5 rounded font-mono">
                        {new Date(personHistory[0].timestamp).toLocaleString()}
                      </span>
                      <span className="bg-black/70 backdrop-blur-sm text-zinc-300 text-[10px] px-2 py-0.5 rounded font-medium">
                        {Math.round((personHistory[0].metadata?.confidence || 0.85) * 100)}% match
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700">
                    <div className="text-center">
                      <Monitor className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-xs text-zinc-600">No recognition yet</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Match History Grid */}
              <div className="flex-1 overflow-hidden flex flex-col p-3">
                <div className="flex items-center justify-between mb-2.5">
                  {personHistory.length > 0 ? (
                    <p className="text-xs text-zinc-400">
                      <span className="text-zinc-100 font-medium">{personHistory.length}</span> detection{personHistory.length !== 1 ? 's' : ''} found
                    </p>
                  ) : (
                    <div className="w-full rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                      <p className="text-[10px] text-amber-300 font-medium">No recognitions yet</p>
                      <p className="text-[9px] text-amber-400/80">This person has not matched any detections.</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {personHistory.length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                      {personHistory.map((match, idx) => (
                        <div key={idx} className="relative group cursor-pointer">
                          <div className="aspect-video rounded overflow-hidden bg-black border border-white/5">
                            <img
                              src={match.metadata?.images?.['face.jpg'] || match.metadata?.images?.['frame.jpg']}
                              className="w-full h-full object-cover group-hover:brightness-110 transition-all"
                              alt=""
                            />
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 pb-0.5 pt-3 rounded-b">
                            <div className="flex items-center justify-between">
                              <span className="text-[7px] text-zinc-400 font-mono">
                                {new Date(match.timestamp).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                              </span>
                              <span className="text-[7px] text-zinc-300 font-medium">
                                {Math.round((match.metadata?.confidence || 0.85) * 100)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
                      No recognition history yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ ENROLL PERSON DIALOG ═══════════════ */}
      <Dialog open={showEnrollDialog} onOpenChange={setShowEnrollDialog}>
        <DialogContent className="max-w-md border border-white/5 bg-zinc-900/95 backdrop-blur-xl p-6 gap-0">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-semibold text-zinc-100">Enroll Person</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 mt-1">Add a new person to the watchlist database.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Photos * <span className="text-xs text-zinc-500">(Multiple angles recommended)</span></label>
              <div
                onClick={() => document.getElementById('enroll-upload')?.click()}
                className="border border-dashed border-white/10 rounded-lg p-5 text-center cursor-pointer hover:bg-black/20 transition-colors"
              >
                <Upload className="h-5 w-5 mx-auto mb-2 text-zinc-600" />
                <p className="text-sm text-zinc-400">
                  {enrollFiles.length > 0 ? `${enrollFiles.length} image(s) selected` : (enrollFile ? enrollFile.name : 'Click to select facial images')}
                </p>
                <p className="text-xs text-zinc-600 mt-1">Upload frontal, left & right profiles for best accuracy</p>
              </div>
              <input
                id="enroll-upload"
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setEnrollFiles(files);
                  if (files.length > 0) setEnrollFile(files[0]);
                }}
              />
              {enrollFiles.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {enrollFiles.map((file, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={URL.createObjectURL(file)}
                        className="w-full aspect-square object-cover rounded border border-white/10"
                        alt={`Preview ${i + 1}`}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEnrollFiles(prev => prev.filter((_, idx) => idx !== i));
                        }}
                        className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded">
                        {i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Name *</label>
              <Input
                value={enrollForm.name}
                onChange={(e) => setEnrollForm({ ...enrollForm, name: e.target.value })}
                placeholder="Full name"
                className="h-9 bg-black/20 border-white/10 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Age</label>
                <Input
                  type="number"
                  value={enrollForm.age}
                  onChange={(e) => setEnrollForm({ ...enrollForm, age: e.target.value })}
                  placeholder="e.g. 35"
                  className="h-9 bg-black/20 border-white/10 text-zinc-100 placeholder:text-zinc-600"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Gender</label>
                <select
                  value={enrollForm.gender}
                  onChange={(e) => setEnrollForm({ ...enrollForm, gender: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Height</label>
                <Input
                  value={enrollForm.height}
                  onChange={(e) => setEnrollForm({ ...enrollForm, height: e.target.value })}
                  placeholder="e.g. 5ft 10in"
                  className="h-9 bg-black/20 border-white/10 text-zinc-100 placeholder:text-zinc-600"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Category</label>
                <select
                  value={enrollForm.category}
                  onChange={(e) => setEnrollForm({ ...enrollForm, category: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="">Select...</option>
                  <option value="Warrant">Warrant</option>
                  <option value="VIP">VIP</option>
                  <option value="Staff">Staff</option>
                  <option value="Blacklist">Blacklist</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Threat Level</label>
                <select
                  value={enrollForm.threatLevel}
                  onChange={(e) => setEnrollForm({ ...enrollForm, threatLevel: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="">Select...</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Notes</label>
              <textarea
                value={enrollForm.notes}
                onChange={(e) => setEnrollForm({ ...enrollForm, notes: e.target.value })}
                placeholder="Additional notes..."
                className="w-full h-20 bg-black/20 border-white/10 text-zinc-100 placeholder:text-zinc-600 rounded-lg px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold text-primary block">Add to Watchlist</label>
                <p className="text-[10px] text-muted-foreground/70">Enable immediate alerts for this person</p>
              </div>
              <Switch
                checked={enrollForm.addToWatchlist}
                onCheckedChange={(val: boolean) => setEnrollForm({ ...enrollForm, addToWatchlist: val })}
                className="data-[state=checked]:bg-primary"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => setShowEnrollDialog(false)}
                className="h-9 text-sm border-white/10 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleEnroll}
                disabled={isUploading || !enrollForm.name || !enrollFile}
                className="h-9 text-sm bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-500"
              >
                {isUploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enroll
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ CONVERT UNKNOWN TO PERSON DIALOG ═══════════════ */}
      <Dialog open={showConvertUnknownDialog} onOpenChange={setShowConvertUnknownDialog}>
        <DialogContent className="max-w-2xl border border-white/5 bg-zinc-900/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-white">Mark as Known Person</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {conversionMode === 'create' ? 'Add details to identify this person and create a profile' : 'Link this face to an existing person in the database'}
            </DialogDescription>
          </DialogHeader>

          {/* Mode Toggle */}
          <div className="flex gap-2 p-1 bg-zinc-900/60 rounded-lg border border-white/5">
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${conversionMode === 'create'
                ? 'bg-emerald-500 text-white'
                : 'text-muted-foreground hover:text-white'
                }`}
              onClick={() => setConversionMode('create')}
            >
              Create New Person
            </button>
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${conversionMode === 'link'
                ? 'bg-blue-500 text-white'
                : 'text-muted-foreground hover:text-white'
                }`}
              onClick={() => setConversionMode('link')}
            >
              Link to Existing
            </button>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-4">
            {/* Face Preview */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Frame Preview</Label>
              <div className="aspect-[4/3] rounded-lg overflow-hidden border border-white/10 bg-black flex items-center justify-center p-1">
                {selectedUnknownForConversion && (
                  <img
                    src={selectedUnknownForConversion.metadata?.fullImageUrl || selectedUnknownForConversion.metadata?.images?.['frame.jpg'] || selectedUnknownForConversion.metadata?.images?.['face.jpg']}
                    className="w-full h-full object-contain rounded"
                    alt="Unknown Person"
                  />
                )}
              </div>
            </div>

            {/* Form Fields - Conditional based on mode */}
            {conversionMode === 'link' ? (
              /* Link Mode: Person Selector */
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Select Person</Label>
                  <select
                    className="w-full h-9 text-xs bg-zinc-900/60 border border-white/5 rounded-md px-3 text-white mt-1"
                    value={selectedPersonForLink?.id || ''}
                    onChange={(e) => {
                      const person = persons.find(p => p.id === e.target.value);
                      setSelectedPersonForLink(person || null);
                    }}
                  >
                    <option value="">-- Select a person --</option>
                    {persons.map(person => (
                      <option key={person.id} value={person.id}>
                        {person.name} ({person.category})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Person Preview */}
                {selectedPersonForLink && (
                  <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-3">
                    <div className="flex gap-3">
                      <div className="h-16 w-16 rounded overflow-hidden border border-white/10 bg-black shrink-0">
                        <img src={selectedPersonForLink.faceImageUrl} className="w-full h-full object-cover" alt="" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{selectedPersonForLink.name}</p>
                        <div className="flex gap-2 mt-1">
                          <Badge className="h-4 text-[8px]">{selectedPersonForLink.category}</Badge>
                          <Badge className="h-4 text-[8px]">{selectedPersonForLink.threatLevel}</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {selectedPersonForLink.age && `Age: ${selectedPersonForLink.age} • `}
                          {selectedPersonForLink.gender && `Gender: ${selectedPersonForLink.gender}`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Create Mode: Form Fields */
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Name *</Label>
                  <Input
                    placeholder="Enter full name"
                    className="h-9 text-xs bg-zinc-900/60 border-white/5 mt-1"
                    value={convertForm.name}
                    onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs">Category</Label>
                  <select
                    className="w-full h-9 text-xs bg-zinc-900/60 border border-white/5 rounded-md px-3 text-white mt-1"
                    value={convertForm.category}
                    onChange={(e) => setConvertForm({ ...convertForm, category: e.target.value })}
                  >
                    <option value="person_of_interest">Person of Interest</option>
                    <option value="suspect">Suspect</option>
                    <option value="witness">Witness</option>
                    <option value="victim">Victim</option>
                    <option value="warrant">Warrant</option>
                    <option value="cleared">Cleared</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs">Threat Level</Label>
                  <select
                    className="w-full h-9 text-xs bg-zinc-900/60 border border-white/5 rounded-md px-3 text-white mt-1"
                    value={convertForm.threatLevel}
                    onChange={(e) => setConvertForm({ ...convertForm, threatLevel: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs">Age</Label>
                  <Input
                    placeholder="e.g., 25-30"
                    className="h-9 text-xs bg-zinc-900/60 border-white/5 mt-1"
                    value={convertForm.age}
                    onChange={(e) => setConvertForm({ ...convertForm, age: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs">Gender</Label>
                  <select
                    className="w-full h-9 text-xs bg-zinc-900/60 border border-white/5 rounded-md px-3 text-white mt-1"
                    value={convertForm.gender}
                    onChange={(e) => setConvertForm({ ...convertForm, gender: e.target.value })}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <Label className="text-xs">Height</Label>
                  <Input
                    placeholder="e.g., 5'10 or 178cm"
                    className="h-9 text-xs bg-zinc-900/60 border-white/5 mt-1"
                    value={convertForm.height}
                    onChange={(e) => setConvertForm({ ...convertForm, height: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label className="text-xs">Aliases</Label>
                  <Input
                    placeholder="Comma-separated aliases"
                    className="h-9 text-xs bg-zinc-900/60 border-white/5 mt-1"
                    value={convertForm.aliases}
                    onChange={(e) => setConvertForm({ ...convertForm, aliases: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label className="text-xs">Notes</Label>
                  <textarea
                    placeholder="Additional information..."
                    className="w-full h-20 text-xs bg-zinc-900/60 border border-white/5 rounded-md px-3 py-2 text-white mt-1 resize-none"
                    value={convertForm.notes}
                    onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })}
                  />
                </div>

                <div className="col-span-2 flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5 mt-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-primary">Add to Watchlist</Label>
                    <p className="text-[10px] text-muted-foreground/70">Mark as high threat for immediate alert generation</p>
                  </div>
                  <Switch
                    checked={convertForm.addToWatchlist}
                    onCheckedChange={(val: boolean) => setConvertForm({ ...convertForm, addToWatchlist: val })}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs border-white/10"
              onClick={() => {
                setShowConvertUnknownDialog(false);
                setSelectedUnknownForConversion(null);
              }}
              disabled={isConverting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={`h-9 text-xs ${conversionMode === 'link' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
              onClick={conversionMode === 'link' ? handleLinkUnknownToPerson : handleConvertUnknownToPerson}
              disabled={isConverting || (conversionMode === 'create' ? !convertForm.name : !selectedPersonForLink)}
            >
              {isConverting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  {conversionMode === 'link' ? 'Linking...' : 'Creating...'}
                </>
              ) : (
                <>
                  <UserCheck className="h-3 w-3 mr-1.5" />
                  {conversionMode === 'link' ? 'Link & Add to Gallery' : 'Create Person Profile'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div >
  );
}
