/**
 * Folder picker — choose an existing folder, un-file, or create a new
 * one, for the session under the cursor. Built on DialogSelect so
 * navigation/selection follow the shared list conventions.
 */

import { useCallback } from "react"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import { openTextPrompt } from "./text-prompt"

export const openFolderPicker = (
  dialog: ReturnType<typeof useDialog>,
  opts: {
    /** Current folder of the session ("" = un-filed). */
    current: string
    /** Existing folder names to choose from. */
    folders: string[]
    /** Called with the chosen folder ("" = un-filed). */
    onPick: (name: string) => void
    /** Called after the user creates and types a new folder name. */
    onNew: (name: string) => void
  },
): void => {
  dialog.replace(
    <FolderPickerDialog {...opts} />,
  )
}

const FolderPickerDialog = ({ current, folders, onPick, onNew }: {
  current: string
  folders: string[]
  onPick: (name: string) => void
  onNew: (name: string) => void
}) => {
  const dialog = useDialog()
  const options: SelectOption[] = [
    { title: "（未分组）", value: "" },
    ...folders.map(f => ({ title: `📁 ${f}`, value: f })),
    { title: "+ 新建文件夹…", value: "__new" },
  ]

  const onSelect = useCallback((opt: SelectOption) => {
    dialog.clear()
    if (opt.value === "__new") {
      void openTextPrompt(dialog, {
        title: "New folder", label: "Folder name", initial: "",
      }).then(name => {
        const n = name?.trim()
        if (n) onNew(n)
      })
      return
    }
    onPick(opt.value)
  }, [dialog, onNew, onPick])

  return (
    <DialogSelect
      title="Folder"
      options={options}
      current={current}
      onSelect={onSelect}
      filterable={false}
      placeholder=""
    />
  )
}
