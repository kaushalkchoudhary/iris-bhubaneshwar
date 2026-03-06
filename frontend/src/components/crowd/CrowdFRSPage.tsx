import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users, Search, Upload, Plus, Monitor,
  AlertTriangle, X, Loader2, Trash, Edit,
  UserX, UserCheck, ScanFace
} from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { Person } from '@/lib/api';

// Modular Tab Components
import { LiveMonitorTab } from './frs/LiveMonitorTab';
import { WatchlistTab } from './frs/WatchlistTab';
import { SubjectSearchTab } from './frs/SubjectSearchTab';
import { AlertHistoryTab } from './frs/AlertHistoryTab';
import { UnknownSubjectsTab } from './frs/UnknownSubjectsTab';
import { DetectionFrame, normalizeAlertTitle } from './frs/FRSShared';
import type { CrowdAlert } from './frs/FRSShared';


const formatMetadata = (val: any) => {
  if (val === undefined || val === null || val === '') return 'N/A';
  const str = String(val).replace(/^(age_|gender_)/i, '').replace(/_/g, ' ');
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

const extractPersonGalleryImages = (person?: Person | null): string[] => {
  const metadata = person?.metadata as any;
  if (!metadata) return [];
  const candidates = [
    metadata.galleryImages,
    metadata.gallery_images,
    metadata.images,
    metadata.embeddingImages,
    metadata.embedding_images,
  ];
  for (const item of candidates) {
    if (Array.isArray(item)) {
      const urls = item.filter((v) => typeof v === 'string' && v.length > 0);
      if (urls.length > 0) return urls;
    }
  }
  return [];
};
const FRS_TAB_ROUTES = {
  live: '/frs/live',
  watchlist: '/frs/watchlist',
  search: '/frs/search',
  alerts: '/frs/alerts',
  unknown: '/frs/unknown',
} as const;

type FrsTabKey = keyof typeof FRS_TAB_ROUTES;

const resolveTabFromPath = (pathname: string): FrsTabKey | null => {
  if (pathname === '/frs' || pathname === '/frs/') return 'live';
  const segment = pathname.replace(/^\/frs\/?/, '').split('/')[0];
  if (segment === 'identified') return 'watchlist';
  if (segment in FRS_TAB_ROUTES) return segment as FrsTabKey;
  return null;
};


export function CrowdFRSPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = resolveTabFromPath(location.pathname) ?? 'live';
  const dashboardDialogClass = "border border-border bg-popover/96 backdrop-blur-sm text-popover-foreground shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden";
  const dashboardFieldClass = "mt-1 h-9 bg-background/50 border-input text-foreground placeholder:text-muted-foreground text-xs";
  const dashboardSelectClass = "mt-1 h-9 w-full rounded-sm border border-input bg-background/50 px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring/20 focus:border-ring/40";
  const dashboardTextAreaClass = "mt-1 w-full rounded-sm border border-input bg-background/50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-1 focus:ring-ring/20 focus:border-ring/40";
  const dashboardSectionClass = "rounded-sm border border-border bg-card/50 backdrop-blur-sm";
  const dashboardMetaRowClass = "flex items-center justify-between px-3 py-2";


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
  const [selectedPersonPrimaryMatch, setSelectedPersonPrimaryMatch] = useState<CrowdAlert | null>(null);
  const [personModalFiles, setPersonModalFiles] = useState<File[]>([]);
  const [personModalPreviews, setPersonModalPreviews] = useState<string[]>([]);
  const [isAddingPersonModalGallery, setIsAddingPersonModalGallery] = useState(false);

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

  // Match Modal Snapshot Add State
  const [isAddingToGallery, setIsAddingToGallery] = useState(false);
  // Unknown Faces State
  const [unknownFaces, setUnknownFaces] = useState<any[]>([]);
  const [unknownTotal, setUnknownTotal] = useState(0);
  const [loadingUnknown, setLoadingUnknown] = useState(false);

  // Global Identity (ReID) State
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

  // Jetson workers + cameras for live feed
  const [jetsons, setJetsons] = useState<Array<{
    workerId: string; name: string; ip?: string; reachable: boolean; cameraCount: number;
    resources?: { cpu_load_1m?: number; memory_percent?: number; temperature_c?: number };
  }>>([]);
  const [camerasByWorker, setCamerasByWorker] = useState<Record<string, Array<{ id: string; name: string }>>>({});

  const goToTab = (tab: FrsTabKey) => {
    navigate(FRS_TAB_ROUTES[tab]);
  };

  useEffect(() => {
    const resolved = resolveTabFromPath(location.pathname);
    if (!resolved) {
      navigate(FRS_TAB_ROUTES.live, { replace: true });
      return;
    }
    if (location.pathname.includes('/identified')) {
      navigate(FRS_TAB_ROUTES.watchlist, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    fetchPersons();
    fetchAlerts();
    if (activeTab === 'live') fetchLiveMatches();
    if (activeTab === 'unknown') fetchUnknownFaces();
    const interval = setInterval(() => {
      if (activeTab === 'alerts') fetchAlerts();
      if (activeTab === 'live') fetchLiveMatches();
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
          ip: w.ip,
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

  useEffect(() => {
    if (personHistory.length === 0) {
      setSelectedPersonPrimaryMatch(null);
      return;
    }
    setSelectedPersonPrimaryMatch((prev) => {
      if (!prev) return personHistory[0];
      return personHistory.find((m) => m.id === prev.id) || personHistory[0];
    });
  }, [personHistory, selectedPerson?.id]);

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

  const mapToAlert = (d: any): CrowdAlert => ({
    ...d,
    id: d.id,
    deviceId: d.deviceId,
    alertType: 'face_match',
    title: d.person?.name || d.personId || 'Unknown Subject',
    description: '',
    timestamp: d.timestamp,
    severity: 'high',
    isResolved: false,
    metadata: {
      ...(d.metadata || {}),
      person_id: d.personId,
      person_name: d.person?.name,
      person_face_url: d.person?.faceImageUrl,
      confidence: d.confidence,
      is_known: !!d.personId,
      fullImageUrl: d.fullSnapshotUrl,
      face_box: d.metadata?.face_box || d.metadata?.box || d.metadata?.bounding_box || d.bbox,
      box: d.metadata?.box || d.metadata?.face_box || d.metadata?.bounding_box || d.bbox,
      bounding_box: d.metadata?.bounding_box || d.metadata?.face_box || d.metadata?.box || d.bbox,
      images: {
        ...(d.metadata?.images || {}),
        'face.jpg': d.faceSnapshotUrl,
        'frame.jpg': d.fullSnapshotUrl,
      },
    },
  });

  const fetchAlerts = async () => {
    setLoadingAlerts(true);
    try {
      const data = await apiClient.getFRSDetections({ limit: 50, unknown: false });
      setAlerts(data.map(mapToAlert));
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
      const mapped = data.map(mapToAlert);
      setLiveMatches(prev => {
        const newMatches = mapped.filter((d) => !prev.find(p => p.id === d.id));
        return [...newMatches, ...prev].slice(0, 50);
      });
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUnknownFaces = async () => {
    setLoadingUnknown(true);
    try {
      const [data, stats] = await Promise.all([
        apiClient.getFRSDetections({ limit: 100, unknown: true }),
        apiClient.getFRSStats().catch(() => null),
      ]);
      setUnknownFaces(data);
      setUnknownTotal(stats?.unknownDetections ?? data.length);
    } catch (e) {
      console.error(e);
      setUnknownTotal(unknownFaces.length);
    } finally {
      setLoadingUnknown(false);
    }
  };

  const highThreatCount = persons.filter(p => p.threatLevel?.toLowerCase() === 'high').length;
  const wantedCount = persons.filter(p => p.category?.toLowerCase() === 'warrant').length;

  // ═══════════════ MAIN RENDER ═══════════════

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
      // Resolve the face image URL from all possible fields
      const faceImageUrl = selectedUnknownForConversion.faceSnapshotUrl ||
        selectedUnknownForConversion.metadata?.images?.['face.jpg'] ||
        selectedUnknownForConversion.metadata?.face_face_url || // Some legacy detections
        selectedUnknownForConversion.metadata?.images?.['face_crop.jpg'];

      if (!faceImageUrl) {
        toast({ title: 'Error', description: 'No face image available for this detection', variant: 'destructive' });
        return;
      }

      const response = await fetch(faceImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
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

  const handlePersonModalImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPersonModalFiles(files);
    if (files.length === 0) {
      setPersonModalPreviews([]);
      return;
    }
    const previews: string[] = [];
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        previews.push(reader.result as string);
        if (previews.length === files.length) {
          setPersonModalPreviews(previews);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddPersonModalImages = async () => {
    if (!selectedPerson || personModalFiles.length === 0) return;
    setIsAddingPersonModalGallery(true);
    try {
      const formData = new FormData();
      personModalFiles.forEach((file) => formData.append('images[]', file));
      const result = await apiClient.addPersonEmbeddings(selectedPerson.id, formData);
      setPersons(prev => prev.map(p => (p.id === result.person.id ? result.person : p)));
      setFilteredPersons(prev => prev.map(p => (p.id === result.person.id ? result.person : p)));
      setSelectedPerson(result.person);
      setPersonModalFiles([]);
      setPersonModalPreviews([]);
      toast({
        title: 'Embeddings Updated',
        description: `${result.newEmbeddingsCount} image(s) added. Total: ${result.totalEmbeddings}.`,
      });
    } catch (err) {
      console.error('Error adding watchlist modal images:', err);
      toast({ title: 'Error', description: 'Failed to add images', variant: 'destructive' });
    } finally {
      setIsAddingPersonModalGallery(false);
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

      let updated = await apiClient.updatePerson(editPerson.id, formData);

      // If there are new images, add them to embeddings
      if (editFiles.length > 0) {
        const imageFormData = new FormData();
        editFiles.forEach(file => {
          imageFormData.append('images[]', file);
        });
        const result = await apiClient.addPersonEmbeddings(editPerson.id, imageFormData);
        updated = result.person;
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

  const handleMatchModalAddSnapshotToGallery = async () => {
    if (!selectedMatch) return;

    const personId = selectedMatch.metadata?.person_id;
    const matchedPerson = persons.find(p => String(p.id) === String(personId));

    if (!matchedPerson) {
      toast({ title: 'Error', description: 'No person profile found for this match', variant: 'destructive' });
      return;
    }

    setIsAddingToGallery(true);
    try {
      const faceImageUrl = selectedMatch.metadata?.images?.['face.jpg'] || (selectedMatch as any).faceSnapshotUrl;
      if (!faceImageUrl) {
        toast({ title: 'Error', description: 'No detection face image available', variant: 'destructive' });
        return;
      }

      const response = await fetch(faceImageUrl);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('images[]', blob, `detection-${selectedMatch.id}.jpg`);

      const result = await apiClient.addPersonEmbeddings(matchedPerson.id, formData);

      toast({
        title: 'Added Detection Snapshot',
        description: `${matchedPerson.name} now has ${result.totalEmbeddings} embeddings.`,
        duration: 3000,
      });

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

  const [isExporting] = useState(false);

  return (
    <div className={cn(
      "flex flex-col h-full bg-zinc-950/20 text-foreground overflow-hidden iris-dashboard-root relative"
    )}>
      <Tabs value={activeTab} onValueChange={(value) => goToTab(value as FrsTabKey)} className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="shrink-0 px-4 pt-3 lg:px-8 lg:pt-4 pb-2 border-b border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Title area */}
          <div className="flex items-center gap-3">
            <ScanFace className="h-5 w-5 text-indigo-400" />
            <h1 className="text-lg font-mono font-bold text-zinc-100">Face Recognition</h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wider rounded">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              Live
            </span>
          </div>

          {/* Tab nav — inline, aligned to right */}
          <TabsList className="bg-transparent rounded-none h-auto p-0 justify-end gap-2 border-none">
            {(([
              { key: 'live', icon: Monitor, label: 'Live', count: null, amber: false },
              { key: 'watchlist', icon: Users, label: 'Watchlist', count: null, amber: false },
              { key: 'search', icon: Search, label: 'Search', count: null, amber: false },
              { key: 'alerts', icon: AlertTriangle, label: 'Alerts', count: alerts.length, amber: false },
              { key: 'unknown', icon: UserX, label: 'Unknown', count: unknownTotal, amber: true },
            ]) as Array<{ key: string; icon: React.ComponentType<{ className?: string }>; label: string; count: number | null; amber: boolean }>).map(({ key, icon: Icon, label, count, amber }) => (
              <TabsTrigger
                key={key}
                value={key}
                className={cn(
                  'relative h-8 px-3 rounded text-[11px] font-mono tracking-wide gap-1.5 transition-all duration-200 border',
                  'data-[state=inactive]:text-zinc-500 data-[state=inactive]:bg-transparent data-[state=inactive]:border-transparent data-[state=inactive]:hover:text-zinc-300 data-[state=inactive]:hover:bg-white/5',
                  amber
                    ? 'data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/50 data-[state=active]:bg-amber-500/10'
                    : 'data-[state=active]:text-indigo-300 data-[state=active]:border-indigo-500/50 data-[state=active]:bg-indigo-500/10',
                  'shadow-none'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {count != null && count > 0 && (
                  <span className={cn(
                    'ml-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded',
                    amber ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-500/20 text-indigo-300'
                  )}>{count}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 min-h-0 px-4 pt-4 pb-4 lg:px-8 lg:pb-6 overflow-hidden">
          <TabsContent value="live" className="h-full m-0">
            <LiveMonitorTab
              liveMatches={liveMatches}
              persons={persons}
              jetsons={jetsons}
              camerasByWorker={camerasByWorker}
              onOpenMatchDetail={(match) => {
                setSelectedMatch(match);
                setShowMatchModal(true);
              }}
              onClearMatches={() => setLiveMatches([])}
              onAddToGallery={handleAddToGallery}
              onSwitchTab={(tab) => goToTab(tab as FrsTabKey)}
            />
          </TabsContent>

          <TabsContent value="watchlist" className="h-full m-0">
            <WatchlistTab
              persons={persons}
              filteredPersons={filteredPersons}
              searchQuery={searchQuery}
              watchlistFilter={watchlistFilter}
              onSearchChange={setSearchQuery}
              onFilterChange={setWatchlistFilter}
              onPersonClick={setSelectedPerson}
              onEnrollClick={() => setShowEnrollDialog(true)}
              onEditClick={openEditPerson}
              onRefresh={fetchPersons}
              highThreatCount={highThreatCount}
              wantedCount={wantedCount}
              isExporting={isExporting}
              onExportClick={() => navigate('/analytics')}
            />
          </TabsContent>

          <TabsContent value="search" className="h-full m-0">
            <SubjectSearchTab
              persons={persons}
              searchForm={searchForm}
              searchPreview={searchPreview}
              searchLoading={searchLoading}
              searchResults={searchResults}
              onSearchFormChange={(updates) => setSearchForm({ ...searchForm, ...updates })}
              onSearchFileChange={handleSearchImageChange}
              onSearchSubmit={handleSearchSubmit}
              onPersonClick={(person) => {
                setSelectedPerson(person);
                goToTab('watchlist');
              }}
            />
          </TabsContent>

          <TabsContent value="alerts" className="h-full m-0 -mx-4 lg:-mx-8 -mb-4 lg:-mb-6">
            <AlertHistoryTab
              alerts={alerts}
              selectedAlert={selectedAlert}
              loadingAlerts={false}
              onRefresh={fetchAlerts}
              onSelectAlert={setSelectedAlert}
            />
          </TabsContent>

          <TabsContent value="unknown" className="h-full m-0 -mx-4 lg:-mx-8 -mb-4 lg:-mb-6">
            <UnknownSubjectsTab
              unknownFaces={unknownFaces}
              unknownTotal={unknownTotal}
              loadingUnknown={loadingUnknown}
              onConvertClick={(cluster) => {
                setSelectedUnknownForConversion(cluster);
                setShowConvertUnknownDialog(true);
              }}
            />
          </TabsContent>
        </div>
      </Tabs>


      {/* ═══════════════ PERSON EDIT MODAL ═══════════════ */}
      <Dialog open={showPersonEditModal} onOpenChange={setShowPersonEditModal}>
        <DialogContent className={cn("max-w-2xl p-0 gap-0 max-h-[85vh] overflow-y-auto", dashboardDialogClass)}>
          <DialogHeader className="px-6 pt-5">
            <DialogTitle className="text-lg font-semibold text-foreground">Edit Person</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">Update details and save to the database.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-4 space-y-4">
            <div className="flex gap-4">
              <div className="w-28 shrink-0">
                <div className="aspect-square rounded-lg overflow-hidden border border-border bg-background/60">
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
                  className="w-full mt-1 h-7 text-[10px] border-border text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  onClick={() => document.getElementById('edit-image-upload')?.click()}
                >
                  <Upload className="h-3 w-3 mr-1.5" />
                  {editFiles.length > 0 ? `${editFiles.length} Selected` : 'Choose Files'}
                </Button>

                {/* Image Previews */}
                {editPreviews.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {editPreviews.map((preview, idx) => (
                      <div key={idx} className="aspect-square rounded overflow-hidden border border-border bg-background/60 relative group">
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
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Age</Label>
                  <Input value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Gender</Label>
                  <Input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Threat Level</Label>
                  <Input value={editForm.threatLevel} onChange={(e) => setEditForm({ ...editForm, threatLevel: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                  <Input value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Height</Label>
                  <Input value={editForm.height} onChange={(e) => setEditForm({ ...editForm, height: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Aliases</Label>
                  <Input value={editForm.aliases} onChange={(e) => setEditForm({ ...editForm, aliases: e.target.value })} className={dashboardFieldClass} />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Category</Label>
                  <Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className={dashboardFieldClass} />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Notes</Label>
              <Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className={dashboardFieldClass} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" className="flex-1 h-9 text-xs border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground" onClick={() => setShowPersonEditModal(false)}>
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

      {/* ═══════════════ MATCH DETAILS MODAL ═══════════════ */}
      <Dialog open={showMatchModal} onOpenChange={setShowMatchModal} >
        <DialogContent className={cn("max-w-5xl p-0 gap-0", dashboardDialogClass)}>
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
            return (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] border-b border-white/5">
                  {/* Left panel: reference + metadata */}
                  <div className="p-4 border-b lg:border-b-0 lg:border-r border-border space-y-4 bg-muted/20">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">Reference</p>
                      <div className="aspect-square rounded-lg overflow-hidden bg-black/60 border border-border">
                        {matchPerson?.faceImageUrl || (selectedMatch as any).person?.faceImageUrl ? (
                          <img src={matchPerson?.faceImageUrl || (selectedMatch as any).person?.faceImageUrl} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-700"><Users className="h-10 w-10" /></div>
                        )}
                      </div>
                    </div>

                    <div className={cn(dashboardSectionClass, "divide-y divide-border")}>
                      {[
                        ['Source Node', (selectedMatch as any).device?.name || selectedMatch.deviceId || 'Primary Node'],
                        ['Track ID', (selectedMatch as any).metadata?.track_id || (selectedMatch as any).metadata?.trackId || selectedMatch.id || 'N/A'],
                        ['Age', formatMetadata(matchPerson?.age || (selectedMatch as any).person?.age || selectedMatch.metadata?.ageGroup || selectedMatch.metadata?.age_group)],
                        ['Gender', formatMetadata(matchPerson?.gender || (selectedMatch as any).person?.gender || selectedMatch.metadata?.gender)],
                      ].map(([label, value]) => (
                        <div key={label} className={dashboardMetaRowClass}>
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                          <span className="text-[10px] text-foreground font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right panel: live capture */}
                  <div className="p-4 space-y-3 bg-muted/10">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {normalizeAlertTitle(matchPerson?.name || (selectedMatch as any).person?.name || selectedMatch.metadata?.person_name || selectedMatch.title)}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(selectedMatch.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="relative rounded-lg overflow-hidden bg-black border border-border">
                      {/* Show full frame as main image — gives bust-level context, avoids upscaling blur */}
                      <img
                        src={selectedMatch.metadata?.images?.['frame.jpg'] || selectedMatch.metadata?.images?.['face.jpg']}
                        className="w-full h-[45vh] max-h-[520px] object-contain bg-black"
                        alt=""
                      />
                      {/* Face crop inset — top-right corner, small */}
                      {selectedMatch.metadata?.images?.['face.jpg'] && selectedMatch.metadata?.images?.['frame.jpg'] && (
                        <div className="absolute top-2 right-2 w-16 h-16 rounded-md overflow-hidden border-2 border-white/20 bg-black shadow-lg">
                          <img
                            src={selectedMatch.metadata?.images?.['face.jpg']}
                            className="w-full h-full object-contain"
                            alt=""
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-border space-y-3 bg-muted/10">
                  {/* Add Detection Snapshot to Embeddings */}
                  {matchPerson && (
                    <div className={cn(dashboardSectionClass, "p-3")}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-semibold text-foreground">Add to Gallery</h4>
                          <p className="text-[9px] text-muted-foreground mt-0.5">Use this detected face directly for embeddings.</p>
                        </div>
                        <Button
                          size="sm"
                          className="h-8 text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white"
                          onClick={handleMatchModalAddSnapshotToGallery}
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
                              Add Detection Snapshot
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
                          goToTab('watchlist');
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
      <Dialog open={!!selectedPerson
      } onOpenChange={(open) => {
        if (!open) {
          setSelectedPerson(null);
          setSelectedPersonPrimaryMatch(null);
          setPersonModalFiles([]);
          setPersonModalPreviews([]);
        }
      }}>
        <DialogContent className={cn("max-w-5xl p-0 gap-0 overflow-hidden max-h-[90vh] [&>button]:top-4 [&>button]:right-4 [&>button]:bg-background [&>button]:border [&>button]:border-border [&>button]:rounded-md [&>button]:text-foreground [&>button]:opacity-100", dashboardDialogClass)}>
          <DialogHeader className="sr-only">
            <DialogTitle>Person Profile</DialogTitle>
            <DialogDescription>Profile details and match history</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col lg:flex-row h-full max-h-[90vh] bg-background">
            {/* Left Panel - Profile */}
            <div className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col overflow-y-auto bg-card/50">
              {/* Photo */}
              <div className="aspect-square relative bg-muted shrink-0">
                <img src={selectedPerson?.faceImageUrl} className="w-full h-full object-cover" alt="" />
              </div>

              {/* Info */}
              <div className="p-4 space-y-4 flex-1">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{selectedPerson?.name}</h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedPerson?.id?.slice(0, 12)}</p>
                </div>

                <div className={cn(dashboardSectionClass, "divide-y divide-border")}>
                  {[
                    ['Category', selectedPerson?.category === 'Warrant' ? 'Wanted' : selectedPerson?.category || 'N/A'],
                    ['Threat', selectedPerson?.threatLevel || 'Medium'],
                    ['Age', selectedPerson?.age || '—'],
                    ['Gender', selectedPerson?.gender || '—'],
                    ['Height', selectedPerson?.height || '—'],
                    ['Status', selectedPerson?.status || selectedPerson?.category || '—'],
                    ['Aliases', selectedPerson?.aliases || 'None'],
                  ].map(([label, value]) => (
                    <div key={label} className={dashboardMetaRowClass}>
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className={cn(
                        "text-xs font-medium text-foreground",
                        label === 'Threat' && String(value).toLowerCase() === 'high' ? "text-red-500" :
                          label === 'Threat' && String(value).toLowerCase() === 'medium' ? "text-amber-500" :
                            "text-foreground"
                      )}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Embedding Images */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-foreground">Add Images to Embeddings</h3>
                  </div>

                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        id="person-modal-upload"
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handlePersonModalImageChange}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[10px] border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        onClick={() => document.getElementById('person-modal-upload')?.click()}
                      >
                        <Upload className="h-3 w-3 mr-1.5" />
                        {personModalFiles.length > 0 ? `${personModalFiles.length} selected` : 'Choose Images'}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white"
                        disabled={personModalFiles.length === 0 || isAddingPersonModalGallery}
                        onClick={handleAddPersonModalImages}
                      >
                        {isAddingPersonModalGallery ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            Adding...
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3 mr-1.5" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>

                    {personModalPreviews.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {personModalPreviews.map((preview, idx) => (
                          <div key={idx} className="aspect-square rounded overflow-hidden border border-border bg-black/60">
                            <img src={preview} className="w-full h-full object-cover" alt="" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {extractPersonGalleryImages(selectedPerson).length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] text-muted-foreground mb-2">Saved Embedding Images</p>
                      <div className="grid grid-cols-3 gap-2">
                        {extractPersonGalleryImages(selectedPerson).slice(0, 9).map((img, idx) => (
                          <div key={idx} className="aspect-square rounded overflow-hidden border border-border bg-black/60">
                            <img src={img} className="w-full h-full object-cover" alt="" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8 text-xs border-red-500/40 text-red-400 hover:border-red-500/60 hover:bg-red-500/10"
                    onClick={(e) => { if (selectedPerson) handleDeletePerson(selectedPerson.id, e); }}
                  >
                    <Trash className="h-3 w-3 mr-1.5" /> Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8 text-xs border-border text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    onClick={() => selectedPerson && openEditPerson(selectedPerson)}
                  >
                    <Edit className="h-3 w-3 mr-1.5" /> Edit
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Panel - Detections */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-background/50">
              {/* Latest Surveillance Frame */}
              <div className="h-52 lg:h-[45%] shrink-0 relative bg-muted border-b border-border">
                {selectedPersonPrimaryMatch ? (
                  <>
                    <DetectionFrame
                      frameSrc={selectedPersonPrimaryMatch.metadata?.images?.['frame.jpg'] || (selectedPersonPrimaryMatch as any).fullSnapshotUrl || selectedPersonPrimaryMatch.metadata?.fullImageUrl || selectedPersonPrimaryMatch.metadata?.images?.['face.jpg']}
                      faceSrc={selectedPersonPrimaryMatch.metadata?.images?.['face.jpg'] || (selectedPersonPrimaryMatch as any).faceSnapshotUrl}
                      box={selectedPersonPrimaryMatch.metadata?.face_box || selectedPersonPrimaryMatch.metadata?.box || selectedPersonPrimaryMatch.metadata?.bounding_box || (selectedPersonPrimaryMatch as any).bbox}
                      showBoundingBox={false}
                      className="w-full h-full"
                    />
                    <div className="absolute top-2 left-2 flex items-center gap-2">
                      <span className="bg-popover/90 border border-border text-foreground text-[10px] px-2 py-0.5 rounded font-mono">
                        {new Date(selectedPersonPrimaryMatch.timestamp).toLocaleString()}
                      </span>
                      <span className="bg-popover/90 border border-emerald-500/30 text-emerald-500 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded font-medium">
                        {Math.round((selectedPersonPrimaryMatch.metadata?.confidence || 0.85) * 100)}% match
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs opacity-70">No recognition yet</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Match History Grid */}
              <div className="flex-1 overflow-hidden flex flex-col p-4 bg-background">
                <div className="flex items-center justify-between mb-2.5 gap-3">
                  {personHistory.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground">
                        <span className="text-foreground font-medium">{personHistory.length}</span> detection{personHistory.length !== 1 ? 's' : ''} found
                      </p>
                      <p className="text-[10px] text-muted-foreground/80">
                        {(selectedPersonPrimaryMatch?.device?.name || selectedPersonPrimaryMatch?.deviceId || 'Unknown Camera')} · {selectedPersonPrimaryMatch ? new Date(selectedPersonPrimaryMatch.timestamp).toLocaleTimeString() : ''}
                      </p>
                    </div>
                  ) : (
                    <div className="w-full rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      <p className="text-[10px] text-amber-300 font-medium">No recognitions yet</p>
                      <p className="text-[9px] text-amber-300/90">This person has not matched any detections.</p>
                    </div>
                  )}
                  {!!selectedPerson && !!selectedPersonPrimaryMatch && (
                    <Button
                      size="sm"
                      className="h-7 text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white shrink-0"
                      disabled={isAddingToGallery}
                      onClick={async () => {
                        try {
                          setIsAddingToGallery(true);
                          const faceImageUrl =
                            selectedPersonPrimaryMatch.metadata?.images?.['face.jpg'] ||
                            (selectedPersonPrimaryMatch as any).faceSnapshotUrl;
                          if (!faceImageUrl) {
                            toast({ title: 'Error', description: 'No detection face image available', variant: 'destructive' });
                            return;
                          }
                          const response = await fetch(faceImageUrl);
                          const blob = await response.blob();
                          const formData = new FormData();
                          formData.append('images[]', blob, `detection-${selectedPersonPrimaryMatch.id}.jpg`);
                          const result = await apiClient.addPersonEmbeddings(selectedPerson.id, formData);
                          setPersons(prev => prev.map(p => (p.id === result.person.id ? result.person : p)));
                          setFilteredPersons(prev => prev.map(p => (p.id === result.person.id ? result.person : p)));
                          setSelectedPerson(result.person);
                          toast({
                            title: 'Added Detection Snapshot',
                            description: `${selectedPerson.name} now has ${result.totalEmbeddings} embeddings.`,
                          });
                        } catch (err) {
                          console.error('Failed adding selected detection snapshot:', err);
                          toast({ title: 'Error', description: 'Failed to add detection snapshot', variant: 'destructive' });
                        } finally {
                          setIsAddingToGallery(false);
                        }
                      }}
                    >
                      {isAddingToGallery ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3 mr-1.5" />
                          Add Selected Detection
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {personHistory.length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {personHistory.map((match, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedPersonPrimaryMatch(match)}
                          className={cn(
                            "relative group cursor-pointer text-left rounded-lg",
                            selectedPersonPrimaryMatch?.id === match.id && "ring-1 ring-emerald-400/70"
                          )}
                        >
                          <div className="aspect-video rounded-lg overflow-hidden bg-black border border-white/10">
                            <DetectionFrame
                              frameSrc={match.metadata?.images?.['frame.jpg'] || (match as any).fullSnapshotUrl || match.metadata?.fullImageUrl || match.metadata?.images?.['face.jpg']}
                              faceSrc={match.metadata?.images?.['face.jpg'] || (match as any).faceSnapshotUrl}
                              box={match.metadata?.face_box || match.metadata?.box || match.metadata?.bounding_box || (match as any).bbox}
                              showBoundingBox={false}
                              className="w-full h-full"
                              imgClassName="group-hover:brightness-110 transition-all"
                            />
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 pb-0.5 pt-3 rounded-b">
                            <div className="flex items-center justify-between">
                              <span className="text-[7px] text-white/90 font-mono drop-shadow-md">
                                {new Date(match.timestamp).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                              </span>
                              <span className="text-[7px] text-emerald-400 font-medium drop-shadow-md">
                                {Math.round((match.metadata?.confidence || 0.85) * 100)}%
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
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
      <Dialog open={showEnrollDialog} onOpenChange={setShowEnrollDialog} >
        <DialogContent className={cn("max-w-md p-6 gap-0 max-h-[85vh] overflow-y-auto", dashboardDialogClass)}>
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-semibold text-foreground">Enroll Person</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">Add a new person to the watchlist database.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-foreground mb-1 block">Photos * <span className="text-xs text-muted-foreground/70">(Multiple angles recommended)</span></label>
              <div
                onClick={() => document.getElementById('enroll-upload')?.click()}
                className="border border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:bg-accent/30 transition-colors bg-muted/20"
              >
                <Upload className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  {enrollFiles.length > 0 ? `${enrollFiles.length} image(s) selected` : (enrollFile ? enrollFile.name : 'Click to select facial images')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Upload frontal, left & right profiles for best accuracy</p>
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
                        className="w-full aspect-square object-cover rounded border border-border"
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
              <label className="text-sm text-foreground mb-1 block">Name *</label>
              <Input
                value={enrollForm.name}
                onChange={(e) => setEnrollForm({ ...enrollForm, name: e.target.value })}
                placeholder="Full name"
                className={dashboardFieldClass}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-foreground mb-1 block">Age</label>
                <Input
                  type="number"
                  value={enrollForm.age}
                  onChange={(e) => setEnrollForm({ ...enrollForm, age: e.target.value })}
                  placeholder="e.g. 35"
                  className={dashboardFieldClass}
                />
              </div>
              <div>
                <label className="text-sm text-foreground mb-1 block">Gender</label>
                <select
                  value={enrollForm.gender}
                  onChange={(e) => setEnrollForm({ ...enrollForm, gender: e.target.value })}
                  className={dashboardSelectClass}
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-foreground mb-1 block">Height</label>
                <Input
                  value={enrollForm.height}
                  onChange={(e) => setEnrollForm({ ...enrollForm, height: e.target.value })}
                  placeholder="e.g. 5ft 10in"
                  className={dashboardFieldClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-foreground mb-1 block">Category</label>
                <select
                  value={enrollForm.category}
                  onChange={(e) => setEnrollForm({ ...enrollForm, category: e.target.value })}
                  className={dashboardSelectClass}
                >
                  <option value="">Select...</option>
                  <option value="Warrant">Warrant</option>
                  <option value="VIP">VIP</option>
                  <option value="Staff">Staff</option>
                  <option value="Blacklist">Blacklist</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-foreground mb-1 block">Threat Level</label>
                <select
                  value={enrollForm.threatLevel}
                  onChange={(e) => setEnrollForm({ ...enrollForm, threatLevel: e.target.value })}
                  className={dashboardSelectClass}
                >
                  <option value="">Select...</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground mb-1 block">Notes</label>
              <textarea
                value={enrollForm.notes}
                onChange={(e) => setEnrollForm({ ...enrollForm, notes: e.target.value })}
                placeholder="Additional notes..."
                className={cn(dashboardTextAreaClass, "h-20")}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold text-indigo-300 block">Add to Watchlist</label>
                <p className="text-[10px] text-muted-foreground/70">Enable immediate alerts for this person</p>
              </div>
              <Switch
                checked={enrollForm.addToWatchlist}
                onCheckedChange={(val: boolean) => setEnrollForm({ ...enrollForm, addToWatchlist: val })}
                className="data-[state=checked]:bg-indigo-500"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => setShowEnrollDialog(false)}
                className="h-9 text-sm border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
      <Dialog open={showConvertUnknownDialog} onOpenChange={setShowConvertUnknownDialog} >
        <DialogContent className={cn("max-w-2xl", dashboardDialogClass)}>
          {/* Processing Overlay */}
          {isConverting && (
            <div className="absolute inset-0 z-[100] bg-zinc-950/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full animate-pulse" />
                <Loader2 className="h-12 w-12 text-indigo-500 animate-[spin_2s_linear_infinite] relative" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-mono font-bold text-white tracking-[0.2em] uppercase">
                  {conversionMode === 'create' ? 'Profiling Subject' : 'Linking Identity'}
                </h3>
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest max-w-[240px] leading-relaxed mx-auto">
                  Synchronizing biometric data and computing face embeddings across node cluster...
                </p>
                <div className="flex gap-1 justify-center mt-4">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogHeader>
            <DialogTitle className="text-foreground">Mark as Known Person</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {conversionMode === 'create' ? 'Add details to identify this person and create a profile' : 'Link this face to an existing person in the database'}
            </DialogDescription>
          </DialogHeader>

          {/* Mode Toggle */}
          <div className="flex gap-2 p-1 bg-muted/30 rounded-lg border border-border">
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${conversionMode === 'create'
                ? 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              onClick={() => setConversionMode('create')}
            >
              Create New Person
            </button>
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${conversionMode === 'link'
                ? 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
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
              <div className="aspect-[4/3] rounded-lg overflow-hidden border border-border bg-black/60 flex items-center justify-center p-1">
                {selectedUnknownForConversion && (
                  <img
                    src={selectedUnknownForConversion.faceSnapshotUrl || selectedUnknownForConversion.metadata?.fullImageUrl || selectedUnknownForConversion.metadata?.images?.['frame.jpg'] || selectedUnknownForConversion.metadata?.images?.['face.jpg']}
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
                    className={dashboardSelectClass}
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
                  <div className={cn(dashboardSectionClass, "p-3")}>
                    <div className="flex gap-3">
                      <div className="h-16 w-16 rounded overflow-hidden border border-border bg-black shrink-0">
                        <img src={selectedPersonForLink.faceImageUrl} className="w-full h-full object-cover" alt="" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{selectedPersonForLink.name}</p>
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
                    className={dashboardFieldClass}
                    value={convertForm.name}
                    onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs">Category</Label>
                  <select
                    className={dashboardSelectClass}
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
                    className={dashboardSelectClass}
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
                    className={dashboardFieldClass}
                    value={convertForm.age}
                    onChange={(e) => setConvertForm({ ...convertForm, age: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs">Gender</Label>
                  <select
                    className={dashboardSelectClass}
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
                    className={dashboardFieldClass}
                    value={convertForm.height}
                    onChange={(e) => setConvertForm({ ...convertForm, height: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label className="text-xs">Aliases</Label>
                  <Input
                    placeholder="Comma-separated aliases"
                    className={dashboardFieldClass}
                    value={convertForm.aliases}
                    onChange={(e) => setConvertForm({ ...convertForm, aliases: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label className="text-xs">Notes</Label>
                  <textarea
                    placeholder="Additional information..."
                    className={cn(dashboardTextAreaClass, "h-20")}
                    value={convertForm.notes}
                    onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })}
                  />
                </div>

                <div className="col-span-2 flex items-center justify-between p-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 mt-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-indigo-300">Add to Watchlist</Label>
                    <p className="text-[10px] text-muted-foreground/70">Mark as high threat for immediate alert generation</p>
                  </div>
                  <Switch
                    checked={convertForm.addToWatchlist}
                    onCheckedChange={(val: boolean) => setConvertForm({ ...convertForm, addToWatchlist: val })}
                    className="data-[state=checked]:bg-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
              className="h-9 text-xs bg-indigo-500 hover:bg-indigo-600"
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

    </div>
  );
}
