import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, Plus, Trash2, GripVertical,
  Copy, FileDown, Upload, X, Circle, ArrowRight, Type, Undo, Redo,
} from 'lucide-react';
import { toast } from 'sonner';
import { generateQCPdf } from '@/lib/qc-pdf';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

const QCEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [guide, setGuide] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<{ rowId: string; photoIndex: number; url: string } | null>(null);

  useEffect(() => { loadGuide(); }, [id]);

  const loadGuide = async () => {
    if (!id) return;
    const { data: g } = await supabase.from('qc_guides').select('*, products(name, sku)').eq('id', id).single();
    if (!g) { navigate('/qc'); return; }
    setGuide(g);

    const { data: secs } = await supabase.from('qc_sections')
      .select('*, qc_rows(*)')
      .eq('guide_id', id)
      .order('sort_order');

    const sorted = (secs || []).map(s => ({
      ...s,
      qc_rows: ((s.qc_rows || []) as any[]).sort((a: any, b: any) => a.sort_order - b.sort_order),
    }));
    setSections(sorted);
    setLoading(false);
  };

  // Save helpers
  const saveGuide = async (updates: any) => {
    if (!id) return;
    await supabase.from('qc_guides').update(updates).eq('id', id);
    setGuide((g: any) => ({ ...g, ...updates }));
  };

  const saveSection = async (sectionId: string, updates: any) => {
    await supabase.from('qc_sections').update(updates).eq('id', sectionId);
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...updates } : s));
  };

  const saveRow = async (rowId: string, updates: any) => {
    await supabase.from('qc_rows').update(updates).eq('id', rowId);
    setSections(prev => prev.map(s => ({
      ...s,
      qc_rows: s.qc_rows.map((r: any) => r.id === rowId ? { ...r, ...updates } : r),
    })));
  };

  // Section operations
  const addSection = async (afterIndex: number) => {
    if (!id) return;
    const newOrder = afterIndex + 1;
    for (const s of sections.filter(s => s.sort_order >= newOrder)) {
      await supabase.from('qc_sections').update({ sort_order: s.sort_order + 1 }).eq('id', s.id);
    }
    const { data } = await supabase.from('qc_sections').insert({
      guide_id: id, name: 'New Section', sort_order: newOrder,
    }).select().single();
    if (data) {
      await supabase.from('qc_rows').insert({ section_id: data.id, label: 'New row', sort_order: 0 });
    }
    loadGuide();
  };

  const deleteSection = async (sectionId: string) => {
    await supabase.from('qc_rows').delete().eq('section_id', sectionId);
    await supabase.from('qc_sections').delete().eq('id', sectionId);
    setSections(prev => prev.filter(s => s.id !== sectionId));
  };

  const duplicateSection = async (section: any) => {
    if (!id) return;
    const { data: newSec } = await supabase.from('qc_sections').insert({
      guide_id: id, name: section.name + ' (Copy)', sort_order: section.sort_order + 1,
    }).select().single();
    if (!newSec) return;
    const rows = (section.qc_rows || []).map((r: any, i: number) => ({
      section_id: newSec.id, label: r.label, text_content: r.text_content, photo_urls: r.photo_urls, sort_order: i,
    }));
    if (rows.length) await supabase.from('qc_rows').insert(rows);
    loadGuide();
  };

  // Row operations
  const addRow = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    const maxOrder = Math.max(0, ...(section?.qc_rows || []).map((r: any) => r.sort_order));
    await supabase.from('qc_rows').insert({
      section_id: sectionId, label: 'New row', sort_order: maxOrder + 1,
    });
    loadGuide();
  };

  const deleteRow = async (rowId: string) => {
    await supabase.from('qc_rows').delete().eq('id', rowId);
    setSections(prev => prev.map(s => ({
      ...s,
      qc_rows: s.qc_rows.filter((r: any) => r.id !== rowId),
    })));
  };

  // Photo upload
  const uploadPhotos = async (rowId: string, files: FileList) => {
    const row = sections.flatMap(s => s.qc_rows).find((r: any) => r.id === rowId);
    if (!row) return;
    const existingPhotos = (row.photo_urls || []) as string[];
    const newPhotos = [...existingPhotos];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const path = `${id}/${rowId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('qc-photos').upload(path, file);
      if (error) { toast.error('Upload failed: ' + error.message); continue; }
      const { data: urlData } = supabase.storage.from('qc-photos').getPublicUrl(path);
      newPhotos.push(urlData.publicUrl);
    }
    await saveRow(rowId, { photo_urls: newPhotos });
    toast.success('Photos uploaded');
  };

  const removePhoto = async (rowId: string, photoIndex: number) => {
    const row = sections.flatMap(s => s.qc_rows).find((r: any) => r.id === rowId);
    if (!row) return;
    const photos = [...(row.photo_urls || [])];
    photos.splice(photoIndex, 1);
    await saveRow(rowId, { photo_urls: photos });
  };

  // PDF export
  const exportPdf = async () => {
    if (!guide) return;
    const pdfData = {
      title: guide.title,
      sections: sections.map(s => ({
        name: s.name,
        rows: (s.qc_rows || []).map((r: any) => ({
          label: r.label,
          text_content: r.text_content,
          photo_urls: r.photo_urls || [],
        })),
      })),
    };
    const doc = await generateQCPdf(pdfData);
    doc.save(`${guide.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    toast.success('PDF exported');
  };

  // ---- Drag & Drop ----
  const onDragEnd = async (result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    if (type === 'SECTION') {
      const reordered = Array.from(sections);
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      // Update sort_order
      const updated = reordered.map((s, i) => ({ ...s, sort_order: i }));
      setSections(updated);
      // Persist
      await Promise.all(updated.map(s =>
        supabase.from('qc_sections').update({ sort_order: s.sort_order }).eq('id', s.id)
      ));
      return;
    }

    if (type === 'ROW') {
      const sourceSectionId = source.droppableId;
      const destSectionId = destination.droppableId;

      if (sourceSectionId === destSectionId) {
        // Reorder within same section
        const section = sections.find(s => s.id === sourceSectionId);
        if (!section) return;
        const rows = Array.from(section.qc_rows);
        const [moved] = rows.splice(source.index, 1);
        rows.splice(destination.index, 0, moved);
        const updatedRows = rows.map((r: any, i: number) => ({ ...r, sort_order: i }));
        setSections(prev => prev.map(s => s.id === sourceSectionId ? { ...s, qc_rows: updatedRows } : s));
        await Promise.all(updatedRows.map((r: any) =>
          supabase.from('qc_rows').update({ sort_order: r.sort_order }).eq('id', r.id)
        ));
      } else {
        // Move row between sections
        const srcSection = sections.find(s => s.id === sourceSectionId);
        const dstSection = sections.find(s => s.id === destSectionId);
        if (!srcSection || !dstSection) return;

        const srcRows = Array.from(srcSection.qc_rows);
        const dstRows = Array.from(dstSection.qc_rows);
        const [moved] = srcRows.splice(source.index, 1);
        dstRows.splice(destination.index, 0, moved);

        const updatedSrc = srcRows.map((r: any, i: number) => ({ ...r, sort_order: i }));
        const updatedDst = dstRows.map((r: any, i: number) => ({ ...r, sort_order: i }));

        setSections(prev => prev.map(s => {
          if (s.id === sourceSectionId) return { ...s, qc_rows: updatedSrc };
          if (s.id === destSectionId) return { ...s, qc_rows: updatedDst };
          return s;
        }));

        // Update section_id for moved row + all sort orders
        await supabase.from('qc_rows').update({ section_id: destSectionId }).eq('id', (moved as any).id);
        await Promise.all([
          ...updatedSrc.map((r: any) => supabase.from('qc_rows').update({ sort_order: r.sort_order }).eq('id', r.id)),
          ...updatedDst.map((r: any) => supabase.from('qc_rows').update({ sort_order: r.sort_order }).eq('id', r.id)),
        ]);
      }
    }
  };

  if (loading) return <AppLayout><div className="p-8 text-center text-muted-foreground">Loading...</div></AppLayout>;
  if (!guide) return null;

  return (
    <AppLayout>
      <div className="space-y-4 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/qc')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {editingTitle ? (
            <Input
              className="text-lg font-bold h-9 w-96"
              value={guide.title}
              onChange={e => setGuide({ ...guide, title: e.target.value })}
              onBlur={() => { saveGuide({ title: guide.title }); setEditingTitle(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { saveGuide({ title: guide.title }); setEditingTitle(false); } }}
              autoFocus
            />
          ) : (
            <h1 className="text-lg font-bold cursor-pointer hover:text-primary" onClick={() => setEditingTitle(true)}>
              {guide.title}
            </h1>
          )}
          <Badge
            variant={guide.status === 'final' ? 'default' : 'secondary'}
            className="cursor-pointer text-xs"
            onClick={() => saveGuide({ status: guide.status === 'final' ? 'draft' : 'final' })}
          >
            {guide.status === 'final' ? 'Final' : 'Draft'} ↔
          </Badge>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileDown className="h-4 w-4 mr-1" /> Export PDF
            </Button>
          </div>
        </div>

        {/* Drag & Drop Sections */}
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="sections" type="SECTION">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
                {sections.map((section, si) => (
                  <Draggable key={section.id} draggableId={section.id} index={si}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`border rounded-lg overflow-hidden ${dragSnapshot.isDragging ? 'shadow-lg ring-2 ring-primary/30' : ''}`}
                      >
                        {/* Section header */}
                        <div className="bg-muted/50 px-3 py-2 flex items-center gap-2">
                          <div {...dragProvided.dragHandleProps} className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-muted">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <Input
                            className="h-7 text-sm font-semibold border-none bg-transparent px-1 focus-visible:ring-1"
                            value={section.name}
                            onChange={e => setSections(prev => prev.map(s => s.id === section.id ? { ...s, name: e.target.value } : s))}
                            onBlur={() => saveSection(section.id, { name: section.name })}
                          />
                          <div className="ml-auto flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicateSection(section)} title="Duplicate section">
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteSection(section.id)} title="Delete section">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Rows — droppable */}
                        <Droppable droppableId={section.id} type="ROW">
                          {(rowProvided, rowSnapshot) => (
                            <div
                              ref={rowProvided.innerRef}
                              {...rowProvided.droppableProps}
                              className={`divide-y min-h-[32px] ${rowSnapshot.isDraggingOver ? 'bg-primary/5' : ''}`}
                            >
                              {(section.qc_rows || []).map((row: any, ri: number) => (
                                <Draggable key={row.id} draggableId={row.id} index={ri}>
                                  {(rowDragProvided, rowDragSnapshot) => (
                                    <div
                                      ref={rowDragProvided.innerRef}
                                      {...rowDragProvided.draggableProps}
                                      className={`flex gap-2 p-2 items-start ${
                                        rowDragSnapshot.isDragging ? 'shadow-md bg-background ring-1 ring-primary/20' : ''
                                      } ${selectedRow === row.id ? 'bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/30'}`}
                                    >
                                      {/* Drag handle */}
                                      <div
                                        {...rowDragProvided.dragHandleProps}
                                        className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-muted mt-0.5"
                                      >
                                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                                      </div>

                                      {/* Label */}
                                      <div className="w-48 shrink-0">
                                        <Input
                                          className="h-7 text-xs font-medium"
                                          value={row.label}
                                          onChange={e => setSections(prev => prev.map(s => ({
                                            ...s,
                                            qc_rows: s.qc_rows.map((r: any) => r.id === row.id ? { ...r, label: e.target.value } : r),
                                          })))}
                                          onBlur={() => saveRow(row.id, { label: row.label })}
                                        />
                                      </div>

                                      {/* Content + Photos */}
                                      <div className="flex-1 space-y-1" onClick={() => setSelectedRow(row.id)}>
                                        <Textarea
                                          className="min-h-[28px] text-xs resize-none"
                                          rows={1}
                                          placeholder="Notes / specs..."
                                          value={row.text_content || ''}
                                          onChange={e => setSections(prev => prev.map(s => ({
                                            ...s,
                                            qc_rows: s.qc_rows.map((r: any) => r.id === row.id ? { ...r, text_content: e.target.value } : r),
                                          })))}
                                          onBlur={() => saveRow(row.id, { text_content: row.text_content })}
                                        />
                                        {((row.photo_urls || []) as string[]).length > 0 && (
                                          <div className="flex flex-wrap gap-1">
                                            {((row.photo_urls || []) as string[]).map((url: string, pi: number) => (
                                              <div key={pi} className="relative group">
                                                <img
                                                  src={url}
                                                  alt=""
                                                  className="h-16 w-16 object-cover rounded border cursor-pointer"
                                                  onClick={() => setAnnotatingPhoto({ rowId: row.id, photoIndex: pi, url })}
                                                />
                                                <button
                                                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                  onClick={(e) => { e.stopPropagation(); removePhoto(row.id, pi); }}
                                                >
                                                  <X className="h-2.5 w-2.5" />
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary cursor-pointer">
                                          <Upload className="h-3 w-3" />
                                          <span>Add photos</span>
                                          <input
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            className="hidden"
                                            onChange={e => { if (e.target.files?.length) uploadPhotos(row.id, e.target.files); }}
                                          />
                                        </label>
                                      </div>

                                      {/* Checkbox preview */}
                                      <div className="w-8 flex justify-center pt-1">
                                        <div className="h-4 w-4 border-2 border-muted-foreground/40 rounded-sm" />
                                      </div>

                                      {/* Delete row */}
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => deleteRow(row.id)}>
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {rowProvided.placeholder}
                            </div>
                          )}
                        </Droppable>

                        {/* Add row */}
                        <div className="px-3 py-1.5 border-t">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addRow(section.id)}>
                            <Plus className="h-3 w-3 mr-1" /> Add Row
                          </Button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Add section */}
        <Button variant="outline" size="sm" onClick={() => addSection(sections.length)}>
          <Plus className="h-4 w-4 mr-1" /> Add Section
        </Button>
      </div>

      {/* Photo Annotation Dialog */}
      {annotatingPhoto && (
        <AnnotationDialog
          photoUrl={annotatingPhoto.url}
          onClose={() => setAnnotatingPhoto(null)}
          onSave={async (annotatedUrl: string) => {
            const row = sections.flatMap(s => s.qc_rows).find((r: any) => r.id === annotatingPhoto.rowId);
            if (!row) return;
            const photos = [...(row.photo_urls || [])];
            photos[annotatingPhoto.photoIndex] = annotatedUrl;
            await saveRow(annotatingPhoto.rowId, { photo_urls: photos });
            setAnnotatingPhoto(null);
            toast.success('Annotation saved');
          }}
        />
      )}
    </AppLayout>
  );
};

// Annotation dialog component
const AnnotationDialog = ({ photoUrl, onClose, onSave }: { photoUrl: string; onClose: () => void; onSave: (url: string) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'circle' | 'arrow' | 'text'>('circle');
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setHistory([data]);
      setHistoryIndex(0);
    };
    img.src = photoUrl;
  }, [photoUrl]);

  const getCanvasPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const pushHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(data);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const newIndex = historyIndex - 1;
    ctx.putImageData(history[newIndex], 0, 0);
    setHistoryIndex(newIndex);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const newIndex = historyIndex + 1;
    ctx.putImageData(history[newIndex], 0, 0);
    setHistoryIndex(newIndex);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setDrawing(true);
    setStartPos(getCanvasPos(e));
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!drawing || !startPos) return;
    setDrawing(false);
    const endPos = getCanvasPos(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = Math.max(3, canvas.width / 200);

    if (tool === 'circle') {
      const rx = Math.abs(endPos.x - startPos.x) / 2;
      const ry = Math.abs(endPos.y - startPos.y) / 2;
      const cx = (startPos.x + endPos.x) / 2;
      const cy = (startPos.y + endPos.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 5), Math.max(ry, 5), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'arrow') {
      const dx = endPos.x - startPos.x;
      const dy = endPos.y - startPos.y;
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(15, canvas.width / 40);
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(endPos.x, endPos.y);
      ctx.lineTo(endPos.x - headLen * Math.cos(angle - Math.PI / 6), endPos.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(endPos.x, endPos.y);
      ctx.lineTo(endPos.x - headLen * Math.cos(angle + Math.PI / 6), endPos.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (tool === 'text') {
      const text = prompt('Enter text label:');
      if (text) {
        ctx.fillStyle = '#FF0000';
        ctx.font = `bold ${Math.max(16, canvas.width / 30)}px sans-serif`;
        ctx.fillText(text, startPos.x, startPos.y);
      }
    }

    pushHistory();
    setStartPos(null);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const path = `annotated/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
      const { error } = await supabase.storage.from('qc-photos').upload(path, blob, { contentType: 'image/png' });
      if (error) { toast.error('Failed to save annotation'); return; }
      const { data: urlData } = supabase.storage.from('qc-photos').getPublicUrl(path);
      onSave(urlData.publicUrl);
    }, 'image/png');
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Annotate Photo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <Button variant={tool === 'circle' ? 'default' : 'outline'} size="sm" onClick={() => setTool('circle')}>
              <Circle className="h-4 w-4 mr-1" /> Circle
            </Button>
            <Button variant={tool === 'arrow' ? 'default' : 'outline'} size="sm" onClick={() => setTool('arrow')}>
              <ArrowRight className="h-4 w-4 mr-1" /> Arrow
            </Button>
            <Button variant={tool === 'text' ? 'default' : 'outline'} size="sm" onClick={() => setTool('text')}>
              <Type className="h-4 w-4 mr-1" /> Text
            </Button>
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="sm" onClick={undo} disabled={historyIndex <= 0}>
                <Undo className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={redo} disabled={historyIndex >= history.length - 1}>
                <Redo className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full border rounded cursor-crosshair"
            style={{ maxHeight: '60vh', objectFit: 'contain' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save Annotation</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QCEditor;
