import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  AlertCircle, Check, ChevronRight, FileDown, FileUp, FolderOpen, LoaderCircle, MoreHorizontal,
  Network, Redo2, Search, Undo2, X,
} from 'lucide-react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import sampleProject from '../../samples/operacao-velluto.sample.json';
import { GlobalSearch } from './components/GlobalSearch';
import { ProjectLibrary } from './components/ProjectLibrary';
import { SyncControl } from './components/SyncControl';
import { ToolRail, type EditorTool } from './components/ToolRail';
import { FlowCanvas, type FlowCanvasHandle } from './flow/FlowCanvas';
import { enqueueSave } from './save-queue';
import { saveProjectJson } from './project-export';
import type { Diagram, ExportEnvelope, Project, SearchResult } from './domain';
import {
  createProject, createSubprocess, deleteDiagramSubtree, deleteNodePreservingSubprocess, deleteProject,
  duplicateProject, exportProject, importProject, listProjects, renameDiagram, renameProject, saveDiagram,
} from './repository';
import { getCloudSyncState, requestCloudSync, restoreConflictVersion, setRemoteApplyHooks, startCloudSync, stopCloudSync, subscribeCloudSync, watchNetworkStatus } from './sync/engine';
import { observeFirebaseUser, signInWithGoogle, signOutOfGoogle } from './sync/firebase';
import type { CloudSyncState } from './sync/engine';

type ProjectRecord = { project: Project; diagrams: Diagram[] };
type JsonExportPlugin = { save(options: { filename: string; content: string }): Promise<{ cancelled: boolean; uri?: string }> };
const JsonExport = registerPlugin<JsonExportPlugin>('JsonExport');
type SaveState = 'saved' | 'saving' | 'error';
type ConfirmState = {
  title: string;
  description: string;
  inputLabel?: string;
  value?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
};

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [view, setView] = useState<'library' | 'editor'>('library');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeDiagramId, setActiveDiagramId] = useState('');
  const [projectData, setProjectData] = useState<ExportEnvelope | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [treeOpen, setTreeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<ConfirmState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [cloudSync, setCloudSync] = useState<CloudSyncState>(() => getCloudSyncState());
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [focusNodeId, setFocusNodeId] = useState<string>();
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; label: string } | null>(null);
  const canvasRef = useRef<FlowCanvasHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveSequenceRef = useRef(0);
  const dragRef = useRef<{ id: number; kind: string; label: string; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const skipToolClickRef = useRef(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const activeProjectIdRef = useRef(activeProjectId);
  const viewRef = useRef(view);
  activeProjectIdRef.current = activeProjectId;
  viewRef.current = view;

  const activeProject = useMemo(() => projectData?.project, [projectData]);
  const activeDiagram = useMemo(() => projectData?.diagrams.find((diagram) => diagram.id === activeDiagramId), [projectData, activeDiagramId]);
  const breadcrumbs = useMemo(() => {
    if (!activeDiagram || !projectData) return [] as Diagram[];
    const byId = new Map(projectData.diagrams.map((diagram) => [diagram.id, diagram]));
    const path: Diagram[] = [];
    const seen = new Set<string>();
    let current: Diagram | undefined = activeDiagram;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parentDiagramId ? byId.get(current.parentDiagramId) : undefined;
    }
    return path;
  }, [activeDiagram, projectData]);

  const refreshProjects = useCallback(async () => {
    const latest = await listProjects();
    const records = await Promise.all(latest.map(async (project) => {
      const envelope = await exportProject(project.id);
      return { project: envelope.project, diagrams: envelope.diagrams };
    }));
    setProjects(records);
    requestCloudSync();
    return records;
  }, []);

  useEffect(() => {
    void refreshProjects().catch(() => setSaveState('error'));
  }, [refreshProjects]);

  useEffect(() => {
    const unsubscribeState = subscribeCloudSync(setCloudSync);
    const unsubscribeNetwork = watchNetworkStatus();
    setRemoteApplyHooks({
      beforeApply: async (projectId) => {
        if (viewRef.current === 'editor' && activeProjectIdRef.current === projectId) await canvasRef.current?.flushSave();
      },
      afterApply: async (projectId) => {
        await refreshProjects();
        if (activeProjectIdRef.current === projectId) setProjectData(await exportProject(projectId));
      },
    });
    let unsubscribeAuth: (() => void) | undefined;
    let disposed = false;
    void observeFirebaseUser((user) => {
      if (user) void startCloudSync(user.uid, user.email);
      else stopCloudSync();
    }).then((unsubscribe) => {
      if (disposed) unsubscribe(); else unsubscribeAuth = unsubscribe;
    }).catch((error) => setCloudSync({ ...getCloudSyncState(), status: 'error', message: error instanceof Error ? error.message : 'Não foi possível iniciar a autenticação.' }));
    return () => {
      disposed = true;
      unsubscribeAuth?.();
      unsubscribeNetwork();
      unsubscribeState();
      setRemoteApplyHooks({});
      stopCloudSync();
    };
  }, [refreshProjects]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (view === 'editor' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) canvasRef.current?.redo(); else canvasRef.current?.undo();
      } else if (view === 'editor' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        canvasRef.current?.redo();
      }
    };
    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [view]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      drag.moved ||= distance > 7;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.moved) setDragPreview({ x: event.clientX, y: event.clientY, label: drag.label });
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      dragRef.current = null;
      setDragPreview(null);
      if (!drag.moved) return;
      const underPointer = document.elementFromPoint(event.clientX, event.clientY);
      if (underPointer?.closest('.canvas-region')) {
        canvasRef.current?.addNodeAt(drag.kind as Exclude<EditorTool, 'select' | 'connect'>, event.clientX, event.clientY);
        skipToolClickRef.current = true;
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, []);

  const openProjectAt = useCallback(async (projectId: string, diagramId?: string, focusId?: string) => {
    await canvasRef.current?.flushSave();
    const envelope = await exportProject(projectId);
    const target = envelope.diagrams.find((diagram) => diagram.id === diagramId) ?? envelope.diagrams.find((diagram) => diagram.id === envelope.project.rootDiagramId);
    if (!target) throw new Error('O fluxograma solicitado não foi encontrado.');
    setProjectData(envelope);
    setActiveProjectId(projectId);
    setActiveDiagramId(target.id);
    setView('editor');
    setTreeOpen(false);
    setActiveTool('select');
    setFocusNodeId(undefined);
    if (focusId) window.setTimeout(() => setFocusNodeId(focusId), 20);
    setSaveState('saved');
    await refreshProjects();
  }, [refreshProjects]);

  const navigateDiagram = useCallback(async (diagramId: string, flushCurrent = true) => {
    if (!activeProjectId) return;
    if (flushCurrent) await canvasRef.current?.flushSave();
    const envelope = await exportProject(activeProjectId);
    if (!envelope.diagrams.some((diagram) => diagram.id === diagramId)) return;
    setProjectData(envelope);
    setActiveDiagramId(diagramId);
    setFocusNodeId(undefined);
    setActiveTool('select');
  }, [activeProjectId]);

  const handleCanvasNavigate = useCallback((diagramId: string) => { void navigateDiagram(diagramId); }, [navigateDiagram]);

  const saveActiveDiagram = useCallback((diagram: Diagram) => {
    const sequence = ++saveSequenceRef.current;
    setSaveState('saving');
    saveQueueRef.current = enqueueSave(saveQueueRef.current, async () => {
      await saveDiagram(diagram);
      setProjectData((current) => current ? {
        ...current,
        project: { ...current.project, updatedAt: new Date().toISOString() },
        diagrams: current.diagrams.map((item) => item.id === diagram.id ? diagram : item),
      } : current);
      if (sequence === saveSequenceRef.current) setSaveState('saved');
      requestCloudSync();
      void refreshProjects();
    }).catch((error) => {
      if (sequence === saveSequenceRef.current) setSaveState('error');
      throw error;
    });
    return saveQueueRef.current;
  }, [refreshProjects]);

  const handleToolSelect = (tool: EditorTool) => {
    if (skipToolClickRef.current) { skipToolClickRef.current = false; return; }
    setActiveTool(tool);
  };

  const handleToolPointerDown = (kind: string, label: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { id: event.pointerId, kind, label, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  };

  const openDialog = (state: ConfirmState) => {
    setDialogValue(state.value ?? '');
    setDialogError('');
    setDialog(state);
  };

  const runDialog = async () => {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError('');
    try {
      await dialog.onConfirm(dialogValue);
      setDialog(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      setDialogBusy(false);
    }
  };

  const showCreateProject = () => openDialog({
    title: 'Novo projeto', description: 'Dê um nome para organizar seus fluxogramas.', inputLabel: 'Nome do projeto',
    placeholder: 'Ex.: Atendimento ao cliente', confirmLabel: 'Criar projeto', onConfirm: async (name) => {
      const created = await createProject(name);
      await refreshProjects();
      await openProjectAt(created.project.id, created.project.rootDiagramId);
    },
  });

  const showCreateSubprocess = (ownerNodeId: string | null, suggestedName: string) => {
    openDialog({
      title: 'Novo subprocesso', description: ownerNodeId ? 'O novo fluxograma ficará vinculado ao bloco selecionado.' : 'O novo fluxograma ficará na árvore deste projeto.',
      inputLabel: 'Nome do subprocesso', value: suggestedName, placeholder: 'Ex.: Aprovação de pedido', confirmLabel: 'Criar e abrir',
      onConfirm: async (name) => {
        if (!activeProjectId || !activeDiagramId) throw new Error('Abra um projeto antes de criar subprocessos.');
        await canvasRef.current?.flushSave();
        const child = await createSubprocess(activeProjectId, activeDiagramId, ownerNodeId, name);
        await refreshProjects();
        await navigateDiagram(child.id, false);
      },
    });
  };

  const handleNodeDelete = useCallback(async (nodeId: string) => {
    if (!activeProjectId || !activeDiagramId) return;
    await canvasRef.current?.flushSave();
    await deleteNodePreservingSubprocess(activeProjectId, activeDiagramId, nodeId);
    await refreshProjects();
  }, [activeDiagramId, activeProjectId, refreshProjects]);

  const renameCurrentProject = () => {
    if (!activeProject) return;
    openDialog({ title: 'Renomear projeto', description: 'O novo nome aparece na biblioteca e na navegação.', inputLabel: 'Nome do projeto', value: activeProject.name, confirmLabel: 'Salvar nome', onConfirm: async (name) => { await renameProject(activeProject.id, name); const envelope = await exportProject(activeProject.id); setProjectData(envelope); await refreshProjects(); } });
  };

  const renameCurrentDiagram = () => {
    if (!activeDiagram || !activeProjectId) return;
    openDialog({ title: 'Renomear fluxograma', description: 'O nome do bloco proprietário continua igual até você editá-lo.', inputLabel: 'Nome do fluxograma', value: activeDiagram.name, confirmLabel: 'Salvar nome', onConfirm: async (name) => { await renameDiagram(activeProjectId, activeDiagram.id, name); setProjectData(await exportProject(activeProjectId)); await refreshProjects(); } });
  };

  const showRenameProject = (project: Project) => openDialog({ title: 'Renomear projeto', description: 'Escolha um nome curto para encontrá-lo na biblioteca.', inputLabel: 'Nome do projeto', value: project.name, confirmLabel: 'Salvar nome', onConfirm: async (name) => { await renameProject(project.id, name); await refreshProjects(); if (project.id === activeProjectId) setProjectData(await exportProject(project.id)); } });
  const showDuplicateProject = (project: Project) => openDialog({ title: 'Duplicar projeto', description: `Será criada uma cópia de “${project.name}” com novos IDs e os subprocessos vinculados.`, confirmLabel: 'Duplicar projeto', onConfirm: async () => { await duplicateProject(project.id); await refreshProjects(); } });
  const showDeleteProject = (project: Project) => openDialog({ title: `Excluir “${project.name}”?`, description: 'Todos os fluxogramas deste projeto serão removidos do armazenamento local. Esta ação não pode ser desfeita.', confirmLabel: 'Excluir projeto', danger: true, onConfirm: async () => { await deleteProject(project.id); await refreshProjects(); if (project.id === activeProjectId) { setProjectData(null); setActiveProjectId(''); setView('library'); } } });

  const showDeleteDiagram = () => {
    if (!activeDiagram || !projectData || activeDiagram.id === projectData.project.rootDiagramId) return;
    const ids = new Set([activeDiagram.id]);
    let growing = true;
    while (growing) {
      growing = false;
      projectData.diagrams.forEach((diagram) => { if (diagram.parentDiagramId && ids.has(diagram.parentDiagramId) && !ids.has(diagram.id)) { ids.add(diagram.id); growing = true; } });
    }
    const parentId = activeDiagram.parentDiagramId;
    openDialog({ title: `Excluir “${activeDiagram.name}” e sua subárvore?`, description: `${ids.size} ${ids.size === 1 ? 'fluxograma será removido' : 'fluxogramas serão removidos'}. O conteúdo dos blocos e conexões desses níveis será apagado.`, confirmLabel: `Excluir ${ids.size} ${ids.size === 1 ? 'fluxograma' : 'fluxogramas'}`, danger: true, onConfirm: async () => { await deleteDiagramSubtree(activeProjectId, activeDiagram.id); await refreshProjects(); if (parentId) await navigateDiagram(parentId); else setView('library'); } });
  };

  const downloadProject = async (projectId = activeProjectId) => {
    try {
      if (view === 'editor' && projectId === activeProjectId) await canvasRef.current?.flushSave();
      const envelope = await exportProject(projectId);
      await saveProjectJson(
        envelope.project.name,
        envelope,
        Capacitor.getPlatform(),
        (request) => JsonExport.save(request),
        (filename, content) => {
          const blob = new Blob([content], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
          URL.revokeObjectURL(url);
        },
      );
    } catch (error) {
      openDialog({ title: 'Falha ao exportar projeto', description: error instanceof Error ? error.message : 'Não foi possível salvar o arquivo JSON.', confirmLabel: 'Fechar', onConfirm: () => {} });
    } finally {
      setTopMenuOpen(false);
    }
  };

  const chooseImportFile = () => { setTopMenuOpen(false); importInputRef.current?.click(); };
  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content: unknown = JSON.parse(await file.text());
      const envelope = await importProject(content);
      await refreshProjects();
      await openProjectAt(envelope.project.id, envelope.project.rootDiagramId);
      setSaveState('saved');
    } catch (error) {
      openDialog({ title: 'Não foi possível importar', description: error instanceof Error ? error.message : 'O arquivo não corresponde a uma exportação válida do Fluxos.', confirmLabel: 'Fechar', onConfirm: () => {} });
    } finally {
      event.target.value = '';
    }
  };

  const handleImportExample = async () => {
    try {
      const envelope = await importProject(sampleProject);
      await refreshProjects();
      await openProjectAt(envelope.project.id, envelope.project.rootDiagramId);
    } catch (error) {
      openDialog({ title: 'Falha ao importar o exemplo', description: error instanceof Error ? error.message : 'Não foi possível importar o projeto demonstrativo.', confirmLabel: 'Fechar', onConfirm: () => {} });
    }
  };

  const chooseSearchResult = async (result: SearchResult) => {
    setSearchOpen(false);
    await openProjectAt(result.projectId, result.diagramId, result.nodeId);
  };

  const historyChange = useCallback((canUndo: boolean, canRedo: boolean) => setHistory({ canUndo, canRedo }), []);
  const handleCloudSignIn = async () => { await canvasRef.current?.flushSave(); await signInWithGoogle(); };
  const handleCloudSignOut = async () => { await canvasRef.current?.flushSave(); await signOutOfGoogle(); stopCloudSync(); };
  const exampleImported = projects.some(({ project }) => project.id === sampleProject.project.id);
  const rootDiagramId = projectData?.project.rootDiagramId;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <header className="topbar">
        <button type="button" className="brand-lockup" onClick={async () => { await canvasRef.current?.flushSave(); setView('library'); setTreeOpen(false); }} aria-label="Fluxos, biblioteca de projetos">
          <span className="brand-mark"><img src={`${import.meta.env.BASE_URL}fluxos-icon-v2.svg`} alt="" /></span><strong>Fluxos</strong>
        </button>
        <span className="topbar-rule" />
        {view === 'editor' && activeProject && activeDiagram ? <>
          <button type="button" className="project-switch" title="Voltar para a biblioteca" onClick={async () => { await canvasRef.current?.flushSave(); setView('library'); setTreeOpen(false); }}><span>{activeProject.name}</span><ChevronRight size={15} aria-hidden="true" /></button>
          <span className="topbar-rule project-rule" />
          <nav className="breadcrumbs" aria-label="Caminho do fluxograma">
            <button type="button" className="breadcrumb-home" onClick={async () => { await canvasRef.current?.flushSave(); setView('library'); }} title="Biblioteca" aria-label="Biblioteca de projetos"><FolderOpen size={19} /></button>
            {breadcrumbs.map((crumb, index) => <span className="breadcrumb-part" key={crumb.id}>
              <ChevronRight size={15} aria-hidden="true" />
              {index === breadcrumbs.length - 1 ? <strong aria-current="page" title={crumb.name}>{crumb.name}</strong> : <button type="button" title={crumb.name} onClick={() => { void navigateDiagram(crumb.id); }}>{crumb.name}</button>}
            </span>)}
          </nav>
        </> : <><span className="library-context">Seus projetos</span><span className="topbar-grow" /></>}
        <div className="top-actions">
          {view === 'editor' && <>
            <button type="button" className="icon-button top-action" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={!history.canUndo} onClick={() => canvasRef.current?.undo()}><Undo2 size={20} /></button>
            <button type="button" className="icon-button top-action" title="Refazer (Ctrl+Y)" aria-label="Refazer" disabled={!history.canRedo} onClick={() => canvasRef.current?.redo()}><Redo2 size={20} /></button>
            <span className="topbar-rule" />
          </>}
          <SyncControl
            state={cloudSync}
            onSignIn={handleCloudSignIn}
            onSignOut={handleCloudSignOut}
            onSync={requestCloudSync}
            onRestore={async (conflictId, version) => { await restoreConflictVersion(conflictId, version); await refreshProjects(); }}
          />
          <button ref={searchButtonRef} type="button" className="icon-button top-action" aria-label="Buscar em todos os projetos" title="Buscar em todos os projetos (Ctrl+K)" onClick={() => setSearchOpen(true)}><Search size={21} /></button>
          <div className="top-menu-anchor">
            <button type="button" className="icon-button top-action" aria-label="Mais ações" title="Mais ações" aria-expanded={topMenuOpen} onClick={() => setTopMenuOpen((value) => !value)}><MoreHorizontal size={22} /></button>
            {topMenuOpen && <>
              <button type="button" className="outside-dismiss" aria-label="Fechar menu" onClick={() => setTopMenuOpen(false)} />
              <div className="top-menu" role="menu">
                {view === 'editor' && <>
                  <button type="button" role="menuitem" onClick={() => { void downloadProject(); }}><FileDown size={17} />Exportar projeto JSON</button>
                  <button type="button" role="menuitem" onClick={chooseImportFile}><FileUp size={17} />Importar projeto JSON</button>
                  <div className="menu-separator" />
                  <button type="button" role="menuitem" onClick={() => { setTopMenuOpen(false); renameCurrentDiagram(); }}>Renomear fluxograma</button>
                  <button type="button" role="menuitem" onClick={() => { setTopMenuOpen(false); renameCurrentProject(); }}>Renomear projeto</button>
                  <button type="button" role="menuitem" onClick={() => { setTopMenuOpen(false); showCreateSubprocess(null, `${activeDiagram?.name ?? 'Fluxograma'} — subprocesso`); }}>Criar subprocesso nesta árvore</button>
                  {activeDiagram && activeDiagram.id !== rootDiagramId && <><div className="menu-separator" /><button type="button" role="menuitem" className="danger-action" onClick={() => { setTopMenuOpen(false); showDeleteDiagram(); }}>Excluir fluxograma e subfluxos</button></>}
                </>}
                {view === 'library' && <button type="button" role="menuitem" onClick={chooseImportFile}><FileUp size={17} />Importar projeto JSON</button>}
              </div>
            </>}
          </div>
          {view === 'editor' && <>
            <span className="topbar-rule save-rule" />
            <div className={`save-indicator save-${saveState}`} role="status" aria-live="polite">
              {saveState === 'saving' ? <><LoaderCircle size={17} className="spin" /><span>Salvando</span></> : saveState === 'error' ? <><AlertCircle size={17} /><span>Erro ao salvar</span></> : <><Check size={18} /><span>Salvo</span></>}
            </div>
          </>}
        </div>
      </header>

      {view === 'library' ? <div id="main-content" className="library-wrap">
        <ProjectLibrary
          projects={projects}
          onCreate={showCreateProject}
          onOpen={(projectId, diagramId) => { void openProjectAt(projectId, diagramId); }}
          onRename={showRenameProject}
          onDuplicate={showDuplicateProject}
          onDelete={showDeleteProject}
          onSearch={() => setSearchOpen(true)}
          onImportExample={() => { void handleImportExample(); }}
          exampleImported={exampleImported}
        />
      </div> : activeDiagram && projectData ? <div id="main-content" className="editor-layout">
        <ToolRail
          activeTool={activeTool}
          onSelect={handleToolSelect}
          onShapePointerDown={(kind, event) => handleToolPointerDown(kind, ({ process: 'Processo', decision: 'Decisão', startEnd: 'Início / fim', inputOutput: 'Entrada / saída', note: 'Anotação', text: 'Texto' })[kind], event)}
          onToggleTree={() => setTreeOpen((open) => !open)}
          onOpenLibrary={async () => { await canvasRef.current?.flushSave(); setView('library'); setTreeOpen(false); }}
          treeOpen={treeOpen}
        />
        <FlowCanvas
          key={`${activeProjectId}:${activeDiagram.id}`}
          ref={canvasRef}
          diagram={activeDiagram}
          diagrams={projectData.diagrams}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onSave={saveActiveDiagram}
          onNavigate={handleCanvasNavigate}
          onRequestSubprocess={showCreateSubprocess}
          onDeleteNode={handleNodeDelete}
          treeOpen={treeOpen}
          onTreeOpenChange={setTreeOpen}
          focusNodeId={focusNodeId}
          onHistoryChange={historyChange}
        />
      </div> : <div className="loading-page"><LoaderCircle className="spin" size={24} /><span>Abrindo fluxograma…</span></div>}

      <input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { void handleImportFile(event); }} />
      {dragPreview && <div className="drag-preview" style={{ left: dragPreview.x + 10, top: dragPreview.y + 10 }} aria-hidden="true"><Network size={16} />{dragPreview.label}</div>}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} onChoose={(result) => { void chooseSearchResult(result); }} />}
      {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !dialogBusy) setDialog(null); }}>
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div className="dialog-heading"><div><h2 id="dialog-title">{dialog.title}</h2><p>{dialog.description}</p></div><button type="button" className="icon-button" aria-label="Fechar" disabled={dialogBusy} onClick={() => setDialog(null)}><X size={19} /></button></div>
          {dialog.inputLabel && <label className="dialog-field"><span>{dialog.inputLabel}</span><input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} placeholder={dialog.placeholder} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runDialog(); } }} /></label>}
          {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" disabled={dialogBusy} onClick={() => setDialog(null)}>Cancelar</button><button type="button" className={`button ${dialog.danger ? 'button-danger' : 'button-primary'}`} disabled={dialogBusy || Boolean(dialog.inputLabel && !dialogValue.trim())} onClick={() => { void runDialog(); }}>{dialogBusy && <LoaderCircle size={16} className="spin" />}{dialog.confirmLabel}</button></div>
        </section>
      </div>}
    </div>
  );
}
