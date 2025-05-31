import React, { useState, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Eye, Settings, PlusCircle, Sun, Moon, Save, Undo, Redo, Share2, FileText, CheckSquare, List, CalendarDays, Type, Pilcrow, ExternalLink, Smartphone, Tablet, Monitor, Palette, Columns, Copy } from 'lucide-react';

// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, addDoc, collection, onSnapshot, query, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// --- Firebase Configuration ---
// IMPORTANT: Replace with your actual Firebase config
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "YOUR_API_KEY", // Replace if not using __firebase_config
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const db = getFirestore(app);
const auth = getAuth(app);
setLogLevel('debug'); // Optional: for Firestore logging

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-form-builder';

// --- Zustand Stores ---
// Store for UI state (theme, current view, etc.)
const useUIStore = create((set) => ({
  theme: localStorage.getItem('theme') || 'light',
  currentView: 'builder', // 'builder', 'filler', 'responses'
  currentFormIdForFiller: null,
  currentFormIdForResponses: null,
  isLoading: false,
  toastMessage: null,
  isAuthReady: false,
  userId: null,
  previewDevice: 'desktop', // 'desktop', 'tablet', 'mobile'
  showShareModal: false,
  shareableLink: '',
  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
  },
  setCurrentView: (view, formId = null) => {
    set({ currentView: view });
    if (view === 'filler') set({ currentFormIdForFiller: formId });
    if (view === 'responses') set({ currentFormIdForResponses: formId });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setToast: (message, duration = 3000) => {
    set({ toastMessage: message });
    if (message && duration) {
      setTimeout(() => set({ toastMessage: null }), duration);
    }
  },
  setAuthReady: (isAuthReady) => set({ isAuthReady }),
  setUserId: (userId) => set({ userId }),
  setPreviewDevice: (device) => set({ previewDevice: device }),
  setShowShareModal: (show, link = '') => set({ showShareModal: show, shareableLink: link }),
}));

// --- Contact Us Template: All fields assigned to step ---
const CONTACT_US_TEMPLATE = (() => {
  const nameField = {
    id: crypto.randomUUID(),
    type: 'TEXT',
    label: 'Name',
    placeholder: 'Enter your full name',
    required: true,
    helpText: '',
  };
  const emailField = {
    id: crypto.randomUUID(),
    type: 'TEXT',
    label: 'Email',
    placeholder: 'Enter your email address',
    required: true,
    helpText: '',
  };
  const messageField = {
    id: crypto.randomUUID(),
    type: 'TEXTAREA',
    label: 'Message',
    placeholder: 'Enter your message',
    required: true,
    helpText: '',
    rows: 4,
  };
  const stepId = crypto.randomUUID();
  return {
    title: 'Contact Us',
    description: 'Please fill out the form below to contact us.',
    fields: [nameField, emailField, messageField],
    steps: [{ id: stepId, name: 'Step 1', fieldIds: [nameField.id, emailField.id, messageField.id] }],
    currentStepId: stepId,
    settings: { theme: 'default' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
})();

// Store for form data and builder state
const useFormStore = create((set, get) => ({
  forms: [], // List of forms created by the user
  currentForm: null, // The form currently being edited { id, title, description, fields, steps, settings }
  selectedFieldId: null,
  history: [], // For undo/redo
  historyIndex: -1, // Current position in history
  draggedFieldType: null, // Track the type of the field being dragged

  // Initialize: Load forms for the current user
  initializeForms: async (userId) => {
    if (!userId) return;
    useUIStore.getState().setLoading(true);
    const formsCollectionPath = `artifacts/${appId}/users/${userId}/forms`;
    const q = query(collection(db, formsCollectionPath));
    
    // Use onSnapshot for real-time updates if desired, or getDocs for one-time fetch
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const userForms = [];
      querySnapshot.forEach((doc) => {
        userForms.push({ id: doc.id, ...doc.data() });
      });
      set({ forms: userForms });
      useUIStore.getState().setLoading(false);
    }, (error) => {
      console.error("Error fetching forms: ", error);
      useUIStore.getState().setToast("Error fetching forms.", 5000);
      useUIStore.getState().setLoading(false);
    });
    return unsubscribe; // Return unsubscribe function for cleanup
  },
  
  // Create a new form
  createNewForm: () => {
    const newForm = {
      id: crypto.randomUUID(),
      title: 'Untitled Form',
      description: '',
      fields: [],
      steps: [{ id: crypto.randomUUID(), name: 'Step 1', fieldIds: [] }], // Default first step
      currentStepId: null, // Will be set to the ID of the first step
      settings: { theme: 'default' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    newForm.currentStepId = newForm.steps[0].id;
    set({ currentForm: newForm, selectedFieldId: null, history: [newForm], historyIndex: 0 });
    get().saveCurrentForm(); // Auto-save new form
  },

  createContactUsForm: () => {
    // Deep clone and assign new IDs for fields and step
    const template = JSON.parse(JSON.stringify(CONTACT_US_TEMPLATE));
    template.id = crypto.randomUUID();
    // Assign new IDs to fields and update step fieldIds accordingly
    template.fields.forEach((field, idx) => {
      const newId = crypto.randomUUID();
      template.steps[0].fieldIds[idx] = newId;
      field.id = newId;
    });
    template.steps[0].id = crypto.randomUUID();
    template.currentStepId = template.steps[0].id;
    set({ currentForm: template, selectedFieldId: null, history: [template], historyIndex: 0 });
    get().saveCurrentForm();
    // Load the newly created form into the editor
    get().loadFormForEditing(template.id);
  },

  // Load an existing form for editing
  loadFormForEditing: (formId) => {
    const formToLoad = get().forms.find(f => f.id === formId);
    if (formToLoad) {
      // Ensure steps and currentStepId are well-defined
      const validatedForm = {
        ...formToLoad,
        steps: formToLoad.steps && formToLoad.steps.length > 0 ? formToLoad.steps : [{ id: crypto.randomUUID(), name: 'Step 1', fieldIds: [] }],
      };
      if (!validatedForm.currentStepId && validatedForm.steps.length > 0) {
        validatedForm.currentStepId = validatedForm.steps[0].id;
      } else if (validatedForm.steps.length === 0) {
         // This case should ideally not happen if forms always have at least one step
        validatedForm.currentStepId = null;
      }

      set({ currentForm: validatedForm, selectedFieldId: null, history: [validatedForm], historyIndex: 0 });
    } else {
      useUIStore.getState().setToast(`Form with ID ${formId} not found.`, 5000);
    }
  },
  
  // Save the current form to Firestore
  saveCurrentForm: async () => {
    const { currentForm } = get();
    const userId = useUIStore.getState().userId;
    if (!currentForm || !userId) {
      // useUIStore.getState().setToast("No form to save or user not identified.", 3000);
      return;
    }
    useUIStore.getState().setLoading(true);
    const formToSave = { ...currentForm, updatedAt: serverTimestamp() };
    const formDocRef = doc(db, `artifacts/${appId}/users/${userId}/forms`, currentForm.id);
    try {
      await setDoc(formDocRef, formToSave, { merge: true });
      useUIStore.getState().setToast("Form saved!", 2000);
      // After saving, update the local 'forms' list to reflect changes without needing a full re-fetch
      set(state => ({
        forms: state.forms.map(f => f.id === currentForm.id ? formToSave : f)
      }));

    } catch (error) {
      console.error("Error saving form: ", error);
      useUIStore.getState().setToast("Error saving form. Check console.", 5000);
    } finally {
      useUIStore.getState().setLoading(false);
    }
  },

  // Update form properties (title, description)
  updateFormDetails: (details) => {
    set(state => {
      if (!state.currentForm) return {};
      const updatedForm = { ...state.currentForm, ...details };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },

  // Add a field to the current step of the current form
  addField: (field) => {
    set(state => {
      if (!state.currentForm || !state.currentForm.currentStepId) return {};
      const newField = { ...field, id: crypto.randomUUID() };
      const updatedFields = [...state.currentForm.fields, newField];
      const updatedSteps = state.currentForm.steps.map(step => {
        if (step.id === state.currentForm.currentStepId) {
          return { ...step, fieldIds: [...(step.fieldIds || []), newField.id] };
        }
        return step;
      });
      const updatedForm = { ...state.currentForm, fields: updatedFields, steps: updatedSteps };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm, selectedFieldId: newField.id };
    });
  },

  // Update a field's properties
  updateField: (fieldId, updates) => {
    set(state => {
      if (!state.currentForm) return {};
      const updatedFields = state.currentForm.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f);
      const updatedForm = { ...state.currentForm, fields: updatedFields };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },

  // Delete a field
  deleteField: (fieldId) => {
    set(state => {
      if (!state.currentForm) return {};
      const updatedFields = state.currentForm.fields.filter(f => f.id !== fieldId);
      const updatedSteps = state.currentForm.steps.map(step => ({
        ...step,
        fieldIds: (step.fieldIds || []).filter(id => id !== fieldId)
      }));
      const updatedForm = { ...state.currentForm, fields: updatedFields, steps: updatedSteps };
      // If the deleted field was selected, deselect it
      const newSelectedFieldId = state.selectedFieldId === fieldId ? null : state.selectedFieldId;
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm, selectedFieldId: newSelectedFieldId };
    });
  },

  // Reorder fields within the current step
  reorderFields: (oldIndex, newIndex) => {
    set(state => {
      if (!state.currentForm || !state.currentForm.currentStepId) return {};
      const currentStep = state.currentForm.steps.find(s => s.id === state.currentForm.currentStepId);
      if (!currentStep || !currentStep.fieldIds) return {};

      const reorderedFieldIds = arrayMove(currentStep.fieldIds, oldIndex, newIndex);
      
      const updatedSteps = state.currentForm.steps.map(step => 
        step.id === state.currentForm.currentStepId ? { ...step, fieldIds: reorderedFieldIds } : step
      );
      const updatedForm = { ...state.currentForm, steps: updatedSteps };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },
  
  selectField: (fieldId) => set({ selectedFieldId: fieldId }),

  // Multi-step form functions
  addStep: () => {
    set(state => {
      if (!state.currentForm) return {};
      const newStep = { id: crypto.randomUUID(), name: `Step ${state.currentForm.steps.length + 1}`, fieldIds: [] };
      const updatedSteps = [...state.currentForm.steps, newStep];
      const updatedForm = { ...state.currentForm, steps: updatedSteps, currentStepId: newStep.id };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },

  updateStep: (stepId, updates) => {
    set(state => {
      if (!state.currentForm) return {};
      const updatedSteps = state.currentForm.steps.map(s => s.id === stepId ? { ...s, ...updates } : s);
      const updatedForm = { ...state.currentForm, steps: updatedSteps };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },

  deleteStep: (stepId) => {
    set(state => {
      if (!state.currentForm || state.currentForm.steps.length <= 1) {
        useUIStore.getState().setToast("Cannot delete the last step.", 3000);
        return {}; // Cannot delete the last step
      }
      // Move fields from deleted step to the previous step or first step
      const stepToDelete = state.currentForm.steps.find(s => s.id === stepId);
      const remainingSteps = state.currentForm.steps.filter(s => s.id !== stepId);
      let targetStepId = state.currentForm.currentStepId === stepId ? 
                         (remainingSteps.length > 0 ? remainingSteps[0].id : null) : 
                         state.currentForm.currentStepId;

      if (stepToDelete && stepToDelete.fieldIds && stepToDelete.fieldIds.length > 0 && remainingSteps.length > 0) {
        const targetStepIndex = Math.max(0, remainingSteps.findIndex(s => s.id === targetStepId));
        remainingSteps[targetStepIndex].fieldIds = [
          ...(remainingSteps[targetStepIndex].fieldIds || []),
          ...(stepToDelete.fieldIds || [])
        ];
      }
      
      const updatedForm = { ...state.currentForm, steps: remainingSteps, currentStepId: targetStepId };
      get()._addHistory(updatedForm);
      return { currentForm: updatedForm };
    });
  },
  
  setCurrentStepId: (stepId) => {
    set(state => {
      if (!state.currentForm) return {};
      const updatedForm = { ...state.currentForm, currentStepId: stepId };
      // No history for just changing current step view
      return { currentForm: updatedForm };
    });
  },

  // History for Undo/Redo
  _addHistory: (formState) => {
    set(state => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(formState))); // Deep copy
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    });
  },
  undo: () => {
    set(state => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return { currentForm: JSON.parse(JSON.stringify(state.history[newIndex])), historyIndex: newIndex, selectedFieldId: null };
      }
      return {};
    });
  },
  redo: () => {
    set(state => {
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return { currentForm: JSON.parse(JSON.stringify(state.history[newIndex])), historyIndex: newIndex, selectedFieldId: null };
      }
      return {};
    });
  },
}));

// --- Available Field Types ---
const FIELD_TYPES = {
  TEXT: { type: 'TEXT', label: 'Text Input', icon: <Type size={18} />, defaultProps: { label: 'Text Field', placeholder: 'Enter text', required: false, helpText: '', minLength: 0, maxLength: 255, pattern: '' } },
  TEXTAREA: { type: 'TEXTAREA', label: 'Textarea', icon: <Pilcrow size={18} />, defaultProps: { label: 'Textarea Field', placeholder: 'Enter longer text', required: false, helpText: '', rows: 3, minLength: 0, maxLength: 1000 } },
  DROPDOWN: { type: 'DROPDOWN', label: 'Dropdown', icon: <List size={18} />, defaultProps: { label: 'Dropdown Field', required: false, helpText: '', options: [{ value: 'option1', label: 'Option 1' }, { value: 'option2', label: 'Option 2' }] } },
  CHECKBOX: { type: 'CHECKBOX', label: 'Checkbox', icon: <CheckSquare size={18} />, defaultProps: { label: 'Checkbox Field', required: false, helpText: '', options: [{ value: 'choice1', label: 'Choice 1', checked: false }] } }, // Can have multiple checkboxes under one "field" or treat each as separate
  DATE: { type: 'DATE', label: 'Date Picker', icon: <CalendarDays size={18} />, defaultProps: { label: 'Date Field', required: false, helpText: '' } },
  FILE: { type: 'FILE', label: 'File Upload', icon: <FileText size={18} />, defaultProps: { label: 'File Upload', required: false, helpText: '', multiple: false, accept: '*' } },
};

// --- Components ---

// Draggable item for the sidebar
const DraggableFieldType = ({ id, fieldConfig }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: 'none', // Important for mobile
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="p-3 mb-2 bg-gray-100 dark:bg-gray-700 rounded-md shadow-sm hover:bg-gray-200 dark:hover:bg-gray-600 cursor-grab flex items-center space-x-2"
    >
      {fieldConfig.icon}
      <span>{fieldConfig.label}</span>
    </div>
  );
};

// Sortable item for fields in the canvas
const SortableFormField = ({ id, field, onSelect, onDelete, isSelected }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 'auto',
    touchAction: 'none',
  };

  const fieldTypeConfig = FIELD_TYPES[field.type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-4 mb-3 rounded-lg shadow-md cursor-default border-2 ${isSelected ? 'border-blue-500 bg-blue-50 dark:bg-gray-700' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800'}`}
      onClick={() => onSelect(field.id)}
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
           <button {...attributes} {...listeners} className="cursor-grab p-1 mr-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <GripVertical size={20} />
          </button>
          <span className="font-semibold text-gray-800 dark:text-gray-200">{field.label || fieldTypeConfig?.label || 'Field'}</span>
          {field.required && <span className="ml-2 text-red-500">*</span>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(field.id); }} className="p-1 text-red-500 hover:text-red-700">
          <Trash2 size={18} />
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{field.placeholder || field.helpText || 'No placeholder or help text'}</p>
      {/* Basic preview of the field type */}
      {field.type === 'TEXT' && <input type="text" placeholder={field.placeholder} className="mt-2 p-2 border rounded-md w-full dark:bg-gray-700 dark:border-gray-600" readOnly />}
      {field.type === 'TEXTAREA' && <textarea placeholder={field.placeholder} rows={field.rows || 2} className="mt-2 p-2 border rounded-md w-full dark:bg-gray-700 dark:border-gray-600" readOnly />}
      {/* Add more previews for other types */}
    </div>
  );
};


const Sidebar = () => {
  const fieldTypeIds = Object.keys(FIELD_TYPES);

  return (
    <div className="w-72 bg-gray-50 dark:bg-gray-800 p-4 border-r dark:border-gray-700 h-full overflow-y-auto">
      <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Form Elements</h3>
      {fieldTypeIds.map(id => (
        <div
          key={id}
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('fieldType', id);
          }}
          className="w-full flex items-center space-x-2 p-3 mb-2 bg-white dark:bg-gray-700 rounded-md shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-left text-gray-700 dark:text-gray-300 cursor-grab"
          style={{ userSelect: 'none' }}
        >
          {FIELD_TYPES[id].icon}
          <span>{FIELD_TYPES[id].label}</span>
        </div>
      ))}
    </div>
  );
};

const Canvas = () => {
  const { currentForm, selectedFieldId, selectField, deleteField, reorderFields, addField } = useFormStore();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  if (!currentForm) {
    return <div className="flex-1 p-8 flex items-center justify-center text-gray-500 dark:text-gray-400">Select or create a form to start building.</div>;
  }
  
  const currentStep = currentForm.steps.find(s => s.id === currentForm.currentStepId);
  const fieldsInCurrentStep = currentStep ? (currentStep.fieldIds || []).map(id => currentForm.fields.find(f => f.id === id)).filter(Boolean) : [];


  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id && over) {
      const oldIndex = fieldsInCurrentStep.findIndex(f => f.id === active.id);
      const newIndex = fieldsInCurrentStep.findIndex(f => f.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderFields(oldIndex, newIndex);
      }
    }
  };
  
  // Handle drop from sidebar
  const handleDrop = (e) => {
    const fieldType = e.dataTransfer.getData('fieldType');
    if (fieldType && FIELD_TYPES[fieldType]) {
      addField({ type: FIELD_TYPES[fieldType].type, ...FIELD_TYPES[fieldType].defaultProps });
    }
  };

  // Droppable area for new fields (simplified - actual drop logic from sidebar is complex)
  // This Droppable is mainly for reordering existing fields.
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div
        className="flex-1 p-4 md:p-8 overflow-y-auto"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="mb-4">
          <input 
            type="text"
            value={currentForm.title}
            onChange={(e) => useFormStore.getState().updateFormDetails({ title: e.target.value })}
            className="text-2xl font-bold p-2 border-b-2 border-transparent focus:border-blue-500 outline-none bg-transparent w-full dark:text-white"
            placeholder="Form Title"
          />
          <textarea
            value={currentForm.description}
            onChange={(e) => useFormStore.getState().updateFormDetails({ description: e.target.value })}
            className="text-sm text-gray-600 dark:text-gray-300 p-2 mt-1 border-b-2 border-transparent focus:border-blue-500 outline-none bg-transparent w-full"
            placeholder="Form description (optional)"
            rows="2"
          />
        </div>

        {/* Step Navigation */}
        <StepTabs />

        {/* Fields Area */}
        {currentStep && fieldsInCurrentStep.length > 0 ? (
          <SortableContext items={fieldsInCurrentStep.map(f => f.id)} strategy={verticalListSortingStrategy}>
            {fieldsInCurrentStep.map(field => (
              <SortableFormField
                key={field.id}
                id={field.id}
                field={field}
                onSelect={selectField}
                onDelete={deleteField}
                isSelected={selectedFieldId === field.id}
              />
            ))}
          </SortableContext>
        ) : (
          <div className="min-h-[200px] border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center p-8 text-gray-500 dark:text-gray-400">
            <p>Drag elements from the left panel or click to add them here.</p>
            <p className="text-sm mt-1">This is the canvas for '{currentStep?.name || 'current step'}'.</p>
          </div>
        )}
      </div>
    </DndContext>
  );
};

const StepTabs = () => {
  const { currentForm, setCurrentStepId, addStep, deleteStep, updateStep } = useFormStore();
  const [editingStepId, setEditingStepId] = useState(null);
  const [editingStepName, setEditingStepName] = useState('');

  if (!currentForm || !currentForm.steps) return null;

  const handleEditStepName = (step) => {
    setEditingStepId(step.id);
    setEditingStepName(step.name);
  };

  const handleSaveStepName = (stepId) => {
    if (editingStepName.trim()) {
      updateStep(stepId, { name: editingStepName.trim() });
    }
    setEditingStepId(null);
  };

  return (
    <div className="mb-6 flex items-center border-b border-gray-200 dark:border-gray-700 pb-2">
      <nav className="flex space-x-1 flex-wrap">
        {currentForm.steps.map((step, index) => (
          <div key={step.id} className="relative group">
            {editingStepId === step.id ? (
              <input
                type="text"
                value={editingStepName}
                onChange={(e) => setEditingStepName(e.target.value)}
                onBlur={() => handleSaveStepName(step.id)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveStepName(step.id)}
                className="px-3 py-2 text-sm font-medium rounded-md bg-transparent border border-blue-500 text-blue-600 dark:text-blue-400"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setCurrentStepId(step.id)}
                onDoubleClick={() => handleEditStepName(step)}
                className={`px-3 py-2 text-sm font-medium rounded-md ${
                  currentForm.currentStepId === step.id
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {step.name || `Step ${index + 1}`}
              </button>
            )}
            {currentForm.steps.length > 1 && (
              <button
                onClick={() => deleteStep(step.id)}
                className="absolute -top-2 -right-2 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete step"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </nav>
      <button
        onClick={addStep}
        className="ml-2 p-2 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        title="Add new step"
      >
        <PlusCircle size={20} />
      </button>
    </div>
  );
};


const PropertiesPanel = () => {
  const { currentForm, selectedFieldId, updateField } = useFormStore();
  const [localProps, setLocalProps] = useState({});

  const selectedField = currentForm?.fields.find(f => f.id === selectedFieldId);

  useEffect(() => {
    if (selectedField) {
      setLocalProps({...selectedField});
    } else {
      setLocalProps({});
    }
  }, [selectedFieldId, currentForm]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setLocalProps(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };
  
  const handleOptionChange = (index, key, value) => {
    setLocalProps(prev => {
      const newOptions = [...(prev.options || [])];
      newOptions[index] = { ...newOptions[index], [key]: value };
      return { ...prev, options: newOptions };
    });
  };

  const addOption = () => {
    setLocalProps(prev => ({
      ...prev,
      options: [...(prev.options || []), { value: `new_option_${(prev.options || []).length +1 }`, label: 'New Option' }]
    }));
  };
  
  const removeOption = (index) => {
     setLocalProps(prev => ({
      ...prev,
      options: (prev.options || []).filter((_, i) => i !== index)
    }));
  };

  // Debounce updates or update on blur/explicit save
  const handleSaveProperties = () => {
    if (selectedFieldId && Object.keys(localProps).length > 0) {
      updateField(selectedFieldId, localProps);
    }
  };
  
  // Auto-save on localProps change (debounced)
  useEffect(() => {
    if (!selectedFieldId || Object.keys(localProps).length === 0 || JSON.stringify(localProps) === JSON.stringify(selectedField)) {
      return;
    }
    const handler = setTimeout(() => {
      updateField(selectedFieldId, localProps);
    }, 500); // Debounce time: 500ms
    return () => clearTimeout(handler);
  }, [localProps, selectedFieldId, updateField, selectedField]);


  if (!selectedField) {
    return <div className="w-80 bg-gray-50 dark:bg-gray-800 p-4 border-l dark:border-gray-700 h-full text-gray-500 dark:text-gray-400">Select a field to edit its properties.</div>;
  }

  const fieldTypeConfig = FIELD_TYPES[selectedField.type];

  return (
    <div className="w-80 bg-gray-50 dark:bg-gray-800 p-4 border-l dark:border-gray-700 h-full overflow-y-auto">
      <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Properties: {fieldTypeConfig?.label}</h3>
      <div className="space-y-4">
        <div>
          <label htmlFor="label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Label</label>
          <input type="text" name="label" id="label" value={localProps.label || ''} onChange={handleChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-2" />
        </div>
        <div>
          <label htmlFor="placeholder" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Placeholder</label>
          <input type="text" name="placeholder" id="placeholder" value={localProps.placeholder || ''} onChange={handleChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-2" />
        </div>
        <div>
          <label htmlFor="helpText" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Help Text</label>
          <textarea name="helpText" id="helpText" value={localProps.helpText || ''} onChange={handleChange} rows="2" className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-2" />
        </div>
        <div className="flex items-center">
          <input type="checkbox" name="required" id="required" checked={localProps.required || false} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" />
          <label htmlFor="required" className="ml-2 block text-sm text-gray-900 dark:text-gray-300">Required</label>
        </div>

        {/* Type-specific properties */}
        {selectedField.type === 'TEXTAREA' && (
          <div>
            <label htmlFor="rows" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Rows</label>
            <input type="number" name="rows" id="rows" value={localProps.rows || 3} onChange={handleChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-2" />
          </div>
        )}
        {(selectedField.type === 'DROPDOWN' || selectedField.type === 'CHECKBOX') && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Options</h4>
            {(localProps.options || []).map((option, index) => (
              <div key={index} className="flex items-center space-x-2 mb-2">
                <input type="text" placeholder="Label" value={option.label} onChange={(e) => handleOptionChange(index, 'label', e.target.value)} className="flex-1 shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-1.5" />
                <input type="text" placeholder="Value" value={option.value} onChange={(e) => handleOptionChange(index, 'value', e.target.value)} className="flex-1 shadow-sm sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-1.5" />
                {selectedField.type === 'CHECKBOX' && (
                    <input type="checkbox" title="Default Checked" checked={option.checked || false} onChange={(e) => handleOptionChange(index, 'checked', e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                )}
                <button onClick={() => removeOption(index)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={16} /></button>
              </div>
            ))}
            <button onClick={addOption} className="mt-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center">
              <PlusCircle size={16} className="mr-1" /> Add Option
            </button>
          </div>
        )}
        {/* Add more specific properties here: minLength, maxLength, pattern for TEXT, etc. */}
        {/* <button onClick={handleSaveProperties} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-sm">
            Save Properties
        </button> */}
      </div>
    </div>
  );
};

const FormPreview = ({ form, device = 'desktop' }) => {
  if (!form) return <div className="p-4 text-center text-gray-500">No form to preview.</div>;

  const [formData, setFormData] = useState({});
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    // Initialize form data state
    const initialData = {};
    form.fields.forEach(field => {
      if (field.type === 'CHECKBOX' && field.options) {
        initialData[field.id] = {};
        field.options.forEach(opt => initialData[field.id][opt.value] = opt.checked || false);
      } else {
        initialData[field.id] = '';
      }
    });
    setFormData(initialData);
    setCurrentStepIndex(0); // Reset to first step when form changes
  }, [form]);

  const handleChange = (fieldId, value, optionValue = null) => {
    setFormData(prev => {
      const newFormData = {...prev};
      if (form.fields.find(f => f.id === fieldId)?.type === 'CHECKBOX') {
        if (!newFormData[fieldId]) newFormData[fieldId] = {};
        newFormData[fieldId][optionValue] = value; // value is boolean (checked state)
      } else {
        newFormData[fieldId] = value;
      }
      return newFormData;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    useUIStore.getState().setToast('Preview submission: ' + JSON.stringify(formData), 5000);
    // In a real scenario, this would submit data
  };

  const currentStepFields = form.steps && form.steps[currentStepIndex] ? 
    (form.steps[currentStepIndex].fieldIds || []).map(id => form.fields.find(f => f.id === id)).filter(Boolean) : 
    form.fields; // Fallback to all fields if steps aren't well-defined for preview

  const deviceWidthClasses = {
    desktop: 'w-full max-w-2xl',
    tablet: 'w-full max-w-md',
    mobile: 'w-full max-w-sm',
  };

  return (
    <div className={`mx-auto p-6 bg-white dark:bg-gray-800 shadow-xl rounded-lg ${deviceWidthClasses[device]}`}>
      <h2 className="text-2xl font-bold mb-1 text-gray-900 dark:text-white">{form.title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{form.description}</p>
      
      {form.steps && form.steps.length > 1 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-300">Step {currentStepIndex + 1} of {form.steps.length}: {form.steps[currentStepIndex]?.name}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-1">
            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${((currentStepIndex + 1) / form.steps.length) * 100}%` }}></div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {currentStepFields.map(field => (
          <div key={field.id} className="mb-4">
            <label htmlFor={field.id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            {field.helpText && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{field.helpText}</p>}
            
            {field.type === 'TEXT' && <input type="text" id={field.id} name={field.id} placeholder={field.placeholder} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
            {field.type === 'TEXTAREA' && <textarea id={field.id} name={field.id} placeholder={field.placeholder} rows={field.rows || 3} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
            {field.type === 'DROPDOWN' && (
              <select id={field.id} name={field.id} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="">{field.placeholder || 'Select an option'}</option>
                {(field.options || []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            )}
            {field.type === 'CHECKBOX' && (field.options || []).map(opt => (
              <div key={opt.value} className="flex items-center mt-1">
                <input type="checkbox" id={`${field.id}-${opt.value}`} name={`${field.id}-${opt.value}`} value={opt.value} checked={formData[field.id]?.[opt.value] || false} onChange={(e) => handleChange(field.id, e.target.checked, opt.value)} className="h-4 w-4 text-blue-600 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" />
                <label htmlFor={`${field.id}-${opt.value}`} className="ml-2 text-sm text-gray-700 dark:text-gray-300">{opt.label}</label>
              </div>
            ))}
            {field.type === 'DATE' && <input type="date" id={field.id} name={field.id} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
            {field.type === 'FILE' && <input type="file" id={field.id} name={field.id} required={field.required} multiple={field.multiple} accept={field.accept} onChange={(e) => handleChange(field.id, e.target.files.length > 0 ? e.target.files[0].name : '')} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-gray-700 dark:file:text-blue-300 dark:hover:file:bg-gray-600" />}
          </div>
        ))}

        <div className="flex justify-between items-center pt-4">
          {currentStepIndex > 0 && (
            <button type="button" onClick={() => setCurrentStepIndex(i => i - 1)} className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
              Previous
            </button>
          )}
          {form.steps && currentStepIndex < form.steps.length - 1 ? (
            <button type="button" onClick={() => setCurrentStepIndex(i => i + 1)} className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
              Next
            </button>
          ) : (
            <button type="submit" className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700">
              Submit Preview
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

const FormFiller = ({ formId, creatorId }) => {
  const { setToast, setLoading } = useUIStore();
  const [formDefinition, setFormDefinition] = useState(null);
  const [formData, setFormData] = useState({});
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!formId || !creatorId) {
      setToast("Form ID or Creator ID is missing.", 5000);
      return;
    }
    setLoading(true);
    const formDocRef = doc(db, `artifacts/${appId}/users/${creatorId}/forms`, formId);
    const unsubscribe = onSnapshot(formDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const formData = docSnap.data();
        setFormDefinition({ id: docSnap.id, ...formData });
        // Initialize form data state
        const initialData = {};
        formData.fields.forEach(field => {
          if (field.type === 'CHECKBOX' && field.options) {
            initialData[field.id] = {};
            field.options.forEach(opt => initialData[field.id][opt.value] = opt.checked || false);
          } else {
            initialData[field.id] = '';
          }
        });
        setFormData(initialData);
        setCurrentStepIndex(0);
      } else {
        setToast("Form not found or you don't have access.", 5000);
        setFormDefinition(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching form for filling: ", error);
      setToast("Error fetching form. " + error.message, 5000);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [formId, creatorId, setToast, setLoading]);

  const handleChange = (fieldId, value, optionValue = null) => {
    setFormData(prev => {
      const newFormData = {...prev};
      if (formDefinition.fields.find(f => f.id === fieldId)?.type === 'CHECKBOX') {
        if (!newFormData[fieldId]) newFormData[fieldId] = {};
        newFormData[fieldId][optionValue] = value;
      } else {
        newFormData[fieldId] = value;
      }
      return newFormData;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formDefinition) return;
    setIsSubmitting(true);
    setToast("Submitting...", null);

    // Basic validation (can be expanded)
    const currentStepFields = formDefinition.steps[currentStepIndex].fieldIds.map(id => formDefinition.fields.find(f => f.id === id)).filter(Boolean);
    for (const field of currentStepFields) {
      if (field.required) {
        if (field.type === 'CHECKBOX') {
          const isAnyChecked = field.options.some(opt => formData[field.id]?.[opt.value]);
          if (!isAnyChecked) {
            setToast(`Field "${field.label}" is required. Please check at least one option.`, 3000);
            setIsSubmitting(false);
            return;
          }
        } else if (!formData[field.id] || String(formData[field.id]).trim() === '') {
          setToast(`Field "${field.label}" is required.`, 3000);
          setIsSubmitting(false);
          return;
        }
      }
    }
    
    if (currentStepIndex < formDefinition.steps.length - 1) {
      setCurrentStepIndex(i => i + 1);
      setIsSubmitting(false);
      setToast(null); // Clear submitting message
      return;
    }

    // Actual submission
    const submissionData = {
      formId: formDefinition.id,
      submittedAt: serverTimestamp(),
      data: formData,
      // May add submitterInfo if users are authenticated for filling
    };
    try {
      const responseCollectionPath = `artifacts/${appId}/users/${creatorId}/forms/${formId}/responses`;
      await addDoc(collection(db, responseCollectionPath), submissionData);
      setToast("Form submitted successfully!", 5000);
      // Reset form or redirect
      const initialDataReset = {};
        formDefinition.fields.forEach(field => {
          if (field.type === 'CHECKBOX' && field.options) {
            initialDataReset[field.id] = {};
            field.options.forEach(opt => initialDataReset[field.id][opt.value] = opt.checked || false);
          } else {
            initialDataReset[field.id] = '';
          }
        });
      setFormData(initialDataReset);
      setCurrentStepIndex(0);
    } catch (error) {
      console.error("Error submitting form: ", error);
      setToast("Error submitting form. " + error.message, 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!formDefinition) {
    return <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900"><div className="p-6 bg-white dark:bg-gray-800 shadow-lg rounded-md text-gray-700 dark:text-gray-300">Loading form... If it takes too long, the form may not exist or the link is incorrect.</div></div>;
  }
  
  const currentStep = formDefinition.steps[currentStepIndex];
  const fieldsForCurrentStep = currentStep ? (currentStep.fieldIds || []).map(id => formDefinition.fields.find(f => f.id === id)).filter(Boolean) : [];


  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-xl rounded-lg p-8">
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">{formDefinition.title}</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">{formDefinition.description}</p>

        {formDefinition.steps && formDefinition.steps.length > 1 && (
          <div className="mb-6">
            <p className="text-sm text-gray-500 dark:text-gray-300">Step {currentStepIndex + 1} of {formDefinition.steps.length}: {currentStep?.name}</p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-1">
              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${((currentStepIndex + 1) / formDefinition.steps.length) * 100}%` }}></div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {fieldsForCurrentStep.map(field => (
             <div key={field.id} className="mb-4">
              <label htmlFor={field.id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.helpText && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{field.helpText}</p>}
              
              {field.type === 'TEXT' && <input type="text" id={field.id} name={field.id} placeholder={field.placeholder} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
              {field.type === 'TEXTAREA' && <textarea id={field.id} name={field.id} placeholder={field.placeholder} rows={field.rows || 3} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
              {field.type === 'DROPDOWN' && (
                <select id={field.id} name={field.id} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  <option value="">{field.placeholder || 'Select an option'}</option>
                  {(field.options || []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              )}
              {field.type === 'CHECKBOX' && (field.options || []).map(opt => (
                <div key={opt.value} className="flex items-center mt-1">
                  <input type="checkbox" id={`${field.id}-${opt.value}`} name={`${field.id}-${opt.value}`} value={opt.value} checked={formData[field.id]?.[opt.value] || false} onChange={(e) => handleChange(field.id, e.target.checked, opt.value)} className="h-4 w-4 text-blue-600 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" />
                  <label htmlFor={`${field.id}-${opt.value}`} className="ml-2 text-sm text-gray-700 dark:text-gray-300">{opt.label}</label>
                </div>
              ))}
              {field.type === 'DATE' && <input type="date" id={field.id} name={field.id} required={field.required} value={formData[field.id] || ''} onChange={(e) => handleChange(field.id, e.target.value)} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />}
              {field.type === 'FILE' && <input type="file" id={field.id} name={field.id} required={field.required} multiple={field.multiple} accept={field.accept} onChange={(e) => handleChange(field.id, e.target.files.length > 0 ? e.target.files[0].name : '')} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-gray-700 dark:file:text-blue-300 dark:hover:file:bg-gray-600" />}
            </div>
          ))}
           <div className="flex justify-between items-center pt-6 border-t dark:border-gray-700">
            {currentStepIndex > 0 && (
              <button type="button" onClick={() => setCurrentStepIndex(i => i - 1)} disabled={isSubmitting} className="px-6 py-2.5 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-600 dark:text-gray-200 dark:border-gray-500 dark:hover:bg-gray-500 disabled:opacity-50">
                Previous
              </button>
            )}
            <button type="submit" disabled={isSubmitting} className="ml-auto px-6 py-2.5 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
              {isSubmitting ? 'Submitting...' : (currentStepIndex < formDefinition.steps.length - 1 ? 'Next' : 'Submit Form')}
            </button>
          </div>
        </form>
      </div>
       <button 
          onClick={() => useUIStore.getState().setCurrentView('builder')}
          className="mt-8 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to Form Builder
        </button>
    </div>
  );
};

const ResponseViewer = ({ formId }) => {
  const { setToast, setLoading, userId } = useUIStore();
  const [responses, setResponses] = useState([]);
  const [formTitle, setFormTitle] = useState('');

  useEffect(() => {
    if (!formId || !userId) {
      setToast("Form ID or User ID is missing for viewing responses.", 3000);
      return;
    }
    setLoading(true);

    // Fetch form title
    const formDocRef = doc(db, `artifacts/${appId}/users/${userId}/forms`, formId);
    getDoc(formDocRef).then(docSnap => {
      if (docSnap.exists()) setFormTitle(docSnap.data().title);
    });

    const responsesCollectionPath = `artifacts/${appId}/users/${userId}/forms/${formId}/responses`;
    const q = query(collection(db, responsesCollectionPath)); // Add orderBy('submittedAt', 'desc') if needed, ensure index in Firestore

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetchedResponses = [];
      querySnapshot.forEach((doc) => {
        fetchedResponses.push({ id: doc.id, ...doc.data() });
      });
      // Sort by submittedAt client-side if not using Firestore orderBy
      fetchedResponses.sort((a, b) => (b.submittedAt?.toDate?.() || 0) - (a.submittedAt?.toDate?.() || 0));
      setResponses(fetchedResponses);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching responses: ", error);
      setToast("Error fetching responses. " + error.message, 5000);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [formId, userId, setToast, setLoading]);

  if (useUIStore.getState().isLoading && responses.length === 0) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading responses...</div>;
  }

  return (
    <div className="p-4 md:p-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Responses for: <span className="text-blue-600 dark:text-blue-400">{formTitle || formId}</span></h1>
          <button 
            onClick={() => useUIStore.getState().setCurrentView('builder')}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md shadow-sm text-sm font-medium"
          >
            ← Back to Builder
          </button>
        </div>

        {responses.length === 0 && !useUIStore.getState().isLoading && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-10">No responses submitted for this form yet.</p>
        )}

        <div className="space-y-6">
          {responses.map(response => (
            <div key={response.id} className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Response ID: {response.id.substring(0,8)}...</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Submitted: {response.submittedAt?.toDate ? response.submittedAt.toDate().toLocaleString() : 'N/A'}
                </p>
              </div>
              <div className="space-y-3">
                {Object.entries(response.data || {}).map(([fieldId, value]) => {
                  // Try to find field label from form definition (not available here directly, would need to pass form fields)
                  // For now, just show fieldId and value.
                  let displayValue = value;
                  if (typeof value === 'object' && value !== null) { // For checkbox groups
                    displayValue = Object.entries(value)
                      .filter(([optVal, checked]) => checked)
                      .map(([optVal]) => optVal)
                      .join(', ');
                  } else if (typeof value === 'boolean') {
                    displayValue = value ? 'Yes' : 'No';
                  }
                  return (
                    <div key={fieldId} className="text-sm">
                      <strong className="text-gray-600 dark:text-gray-300">{fieldId}:</strong> <span className="text-gray-800 dark:text-gray-100">{String(displayValue)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


const FormDashboard = () => {
  const { forms, createNewForm, loadFormForEditing, saveCurrentForm, createContactUsForm } = useFormStore();
  const { setCurrentView, userId, setShowShareModal } = useUIStore();

  const handleShareForm = (formId) => {
    const form = forms.find(f => f.id === formId);
    if (form && userId) {
      // The creatorId is the current userId
      const link = `${window.location.origin}${window.location.pathname}?view=filler&formId=${formId}&creatorId=${userId}`;
      setShowShareModal(true, link); // Pass link as second argument
    } else {
      useUIStore.getState().setToast("Cannot generate share link.", 3000);
    }
  };
  
  const handleDeleteForm = async (formId) => {
    if (!userId || !formId) return;
    if (window.confirm("Are you sure you want to delete this form and all its responses? This action cannot be undone.")) {
      useUIStore.getState().setLoading(true);
      try {
        // Note: Deleting subcollections (responses) requires a bit more work, often a cloud function.
        // For client-side, you'd have to list and delete each response document first.
        // This example only deletes the main form document.
        const formDocRef = doc(db, `artifacts/${appId}/users/${userId}/forms`, formId);
        await deleteDoc(formDocRef);
        useUIStore.getState().setToast("Form deleted (main document only). Responses need manual/server-side cleanup.", 4000);
        // The onSnapshot listener in useFormStore should update the forms list automatically.
      } catch (error) {
        console.error("Error deleting form: ", error);
        useUIStore.getState().setToast("Error deleting form: " + error.message, 5000);
      } finally {
        useUIStore.getState().setLoading(false);
      }
    }
  };

  return (
    <div className="p-4 md:p-8 bg-gray-100 dark:bg-gray-900 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white">My Forms</h1>
          <div className="flex space-x-2">
            <button
              onClick={() => { createNewForm(); setCurrentView('builder-canvas'); }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-sm flex items-center"
            >
              <PlusCircle size={20} className="mr-2" /> Create New Form
            </button>
          <button
            onClick={() => { createContactUsForm(); setCurrentView('builder-canvas'); }}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-md shadow-sm flex items-center"
          >
            <PlusCircle size={20} className="mr-2" /> Create Contact Us Form
          </button>
        </div>
      </div>

        {forms.length === 0 && !useUIStore.getState().isLoading && (
          <div className="text-center py-10">
            <FileText size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-2">No forms yet.</p>
            <p className="text-sm text-gray-500 dark:text-gray-500">Click "Create New Form" to get started.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {forms.map(form => (
            <div key={form.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col">
              <div className="p-5 flex-grow">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2 truncate" title={form.title}>{form.title}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 h-10 overflow-hidden">
                  {form.description || 'No description.'}
                </p>
                 <p className="text-xs text-gray-400 dark:text-gray-500">
                  Fields: {form.fields?.length || 0}, Steps: {form.steps?.length || 0}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Last updated: {form.updatedAt?.toDate ? form.updatedAt.toDate().toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-600 flex flex-wrap gap-2 justify-end">
                <button
                  onClick={() => { loadFormForEditing(form.id); setCurrentView('builder-canvas'); }}
                  className="text-xs bg-blue-500 hover:bg-blue-600 text-white py-1.5 px-3 rounded-md shadow-sm flex items-center"
                >
                  <Settings size={14} className="mr-1"/> Edit
                </button>
                <button
                  onClick={() => setCurrentView('responses', form.id)}
                  className="text-xs bg-green-500 hover:bg-green-600 text-white py-1.5 px-3 rounded-md shadow-sm flex items-center"
                >
                  <Eye size={14} className="mr-1"/> Responses
                </button>
                 <button
                  onClick={() => handleShareForm(form.id)}
                  className="text-xs bg-purple-500 hover:bg-purple-600 text-white py-1.5 px-3 rounded-md shadow-sm flex items-center"
                >
                  <Share2 size={14} className="mr-1"/> Share
                </button>
                <button
                  onClick={() => handleDeleteForm(form.id)}
                  className="text-xs bg-red-500 hover:bg-red-600 text-white py-1.5 px-3 rounded-md shadow-sm flex items-center"
                >
                  <Trash2 size={14} className="mr-1"/> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ShareModal = () => {
  const { showShareModal, shareableLink, setShowShareModal } = useUIStore();
  const [copied, setCopied] = useState(false);

  if (!showShareModal) return null;

  const handleCopy = () => {
    // navigator.clipboard.writeText(shareableLink) // Might not work in iframe
    const textArea = document.createElement("textarea");
    textArea.value = shareableLink;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
      useUIStore.getState().setToast("Failed to copy link.", 3000);
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white">Share Form</h3>
          <button onClick={() => setShowShareModal(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">Share this link with others to fill out your form:</p>
        <div className="flex items-center space-x-2 mb-4">
          <a 
            href={shareableLink} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex-grow p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 underline break-all"
          >
            {shareableLink}
          </a>
          <button 
            onClick={handleCopy}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white ${copied ? 'bg-green-500' : 'bg-blue-500 hover:bg-blue-600'}`}
          >
            {copied ? <CheckSquare size={16}/> : <Copy size={16} />} {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Anyone with this link will be able to access and submit this form. Ensure your Firebase security rules allow read access to the form structure for unauthenticated users if needed, or that users are authenticated.
        </p>
      </div>
    </div>
  );
};


// Main App Component
const App = () => {
  const { theme, setTheme, currentView, currentFormIdForFiller, currentFormIdForResponses, isLoading, toastMessage, isAuthReady, userId, setAuthReady, setUserId, previewDevice, setPreviewDevice } = useUIStore();
  const { currentForm, saveCurrentForm, undo, redo, initializeForms } = useFormStore();
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Initialize Firebase Auth and load forms
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        setAuthReady(true);
        console.log("User is signed in with UID:", user.uid);
        initializeForms(user.uid); 
      } else {
        // Try custom token first, then anonymous
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
            // onAuthStateChanged will trigger again with the new user
          } catch (error) {
            console.error("Error signing in with custom token, trying anonymous:", error);
            await signInAnonymously(auth);
          }
        } else {
          console.log("No initial auth token, signing in anonymously.");
          await signInAnonymously(auth);
        }
      }
    });
    return () => unsubscribeAuth();
  }, [setAuthReady, setUserId, initializeForms]);

  // Ensure theme classes are applied on mount (fix for theme not switching on reload)
  useEffect(() => {
    setTheme(theme);
    // eslint-disable-next-line
  }, []);

  // Auto-apply theme class to HTML element
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
  }, [theme]);

  // Handle URL params for direct form filling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const formIdParam = params.get('formId');
    const creatorIdParam = params.get('creatorId');

    if (viewParam === 'filler' && formIdParam && creatorIdParam) {
      useUIStore.getState().setCurrentView('filler', { formId: formIdParam, creatorId: creatorIdParam });
    }
  }, []);


  // Auto-save periodically (example: every 30 seconds of inactivity after a change)
  const autoSaveTimeoutRef = useRef(null);
  useEffect(() => {
    if (currentForm && currentView === 'builder-canvas') { // Only auto-save if a form is loaded in builder
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        saveCurrentForm();
      }, 15000); // Auto-save after 15 seconds of inactivity
    }
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [currentForm, saveCurrentForm, currentView]);


  if (!isAuthReady) {
    return <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">Initializing Authentication...</div>;
  }
  
  const renderView = () => {
    if (currentView === 'filler' && currentFormIdForFiller) {
      return <FormFiller formId={currentFormIdForFiller.formId} creatorId={currentFormIdForFiller.creatorId} />;
    }
    if (currentView === 'responses' && currentFormIdForResponses) {
      return <ResponseViewer formId={currentFormIdForResponses} />;
    }
    // Default to builder dashboard or canvas
    if (currentView === 'builder-canvas' && currentForm) {
       return (
        <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
          <Sidebar />
          <Canvas />
          <PropertiesPanel />
        </div>
      );
    }
    return <FormDashboard />; // Default to dashboard
  };

  return (
    <div className={`${theme}`}>
      <div className="min-h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
        {/* Global Header only if not in filler view */}
        {currentView !== 'filler' && (
          <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-40">
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">
              <div className="flex items-center">
                <Palette size={28} className="text-blue-600 dark:text-blue-400 mr-2" />
                <h1 className="text-xl font-bold text-gray-800 dark:text-white">Form Builder Deluxe</h1>
                {userId && <span className="ml-4 text-xs text-gray-500 dark:text-gray-400">UID: {userId.substring(0,10)}...</span>}
              </div>
              <div className="flex items-center space-x-3">
                 {currentView === 'builder-canvas' && currentForm && (
                  <>
                    <button onClick={undo} title="Undo" className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50" disabled={useFormStore.getState().historyIndex <= 0}><Undo size={20} /></button>
                    <button onClick={redo} title="Redo" className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50" disabled={useFormStore.getState().historyIndex >= useFormStore.getState().history.length - 1}><Redo size={20} /></button>
                    <button onClick={saveCurrentForm} title="Save Form" className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"><Save size={20} /></button>
                    <button onClick={() => setShowPreviewModal(true)} title="Preview Form" className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"><ExternalLink size={20} /></button>
                    <button onClick={() => useUIStore.getState().setCurrentView('builder')} title="Back to Dashboard" className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                        <Columns size={20} />
                    </button>
                  </>
                )}
                <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                  {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                </button>
              </div>
            </div>
          </header>
        )}
        
        <main className="flex-grow">
          {renderView()}
        </main>

        {isLoading && (
          <div className="fixed bottom-4 right-4 bg-blue-500 text-white text-sm py-2 px-4 rounded-md shadow-lg z-50">
            Loading...
          </div>
        )}
        {toastMessage && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-200 text-white dark:text-black text-sm py-2 px-4 rounded-md shadow-lg z-50">
            {toastMessage}
          </div>
        )}
      </div>
      
      {showPreviewModal && currentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-gray-200 dark:bg-gray-800 p-4 rounded-t-lg w-full max-w-3xl flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Form Preview</h3>
            <div className="flex items-center space-x-2">
                <button onClick={() => setPreviewDevice('mobile')} className={`p-1.5 rounded ${previewDevice === 'mobile' ? 'bg-blue-500 text-white' : 'hover:bg-gray-300 dark:hover:bg-gray-700'}`}><Smartphone size={18}/></button>
                <button onClick={() => setPreviewDevice('tablet')} className={`p-1.5 rounded ${previewDevice === 'tablet' ? 'bg-blue-500 text-white' : 'hover:bg-gray-300 dark:hover:bg-gray-700'}`}><Tablet size={18}/></button>
                <button onClick={() => setPreviewDevice('desktop')} className={`p-1.5 rounded ${previewDevice === 'desktop' ? 'bg-blue-500 text-white' : 'hover:bg-gray-300 dark:hover:bg-gray-700'}`}><Monitor size={18}/></button>
            </div>
            <button onClick={() => setShowPreviewModal(false)} className="text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white text-2xl">&times;</button>
          </div>
          <div className="bg-gray-200 dark:bg-gray-700 p-4 md:p-8 w-full max-w-3xl overflow-y-auto rounded-b-lg">
             <FormPreview form={currentForm} device={previewDevice} />
          </div>
        </div>
      )}
      <ShareModal />
    </div>
  );
};

export default App;

