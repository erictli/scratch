import { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Select,
} from "../ui";

export interface FolderLocationOption {
  label: string;
  value: string;
}

interface FolderNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, location?: string) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  defaultValue?: string;
  locationOptions?: FolderLocationOption[];
  defaultLocation?: string;
}

export function FolderNameDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Create New Folder",
  description = "Enter a name for your new folder",
  confirmLabel = "Create",
  defaultValue = "",
  locationOptions,
  defaultLocation = "",
}: FolderNameDialogProps) {
  const [name, setName] = useState(defaultValue);
  const [location, setLocation] = useState(defaultLocation);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(defaultValue);
      setLocation(defaultLocation);
      // Auto-focus with delay to ensure dialog is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, defaultValue, defaultLocation]);

  const handleConfirm = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) {
      onConfirm(trimmed, locationOptions ? location : undefined);
    }
  }, [name, location, locationOptions, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleConfirm],
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="-mt-1">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Folder name"
          className="mt-1"
        />
        {locationOptions && locationOptions.length > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-text-muted">
              Location
            </label>
            <Select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full"
            >
              {locationOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!name.trim()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
