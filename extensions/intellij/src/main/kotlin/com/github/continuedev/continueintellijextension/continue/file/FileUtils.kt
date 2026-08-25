package com.github.continuedev.continueintellijextension.`continue`.file

import com.github.continuedev.continueintellijextension.FileStats
import com.github.continuedev.continueintellijextension.FileType
import com.intellij.openapi.application.runReadAction
import com.intellij.openapi.application.runWriteAction
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import kotlin.math.min


class FileUtils(
    private val project: Project,
) {
    fun fileExists(fileUri: String): Boolean =
        findFile(fileUri) != null

        fun writeFile(fileUri: String, content: String) {
        val path = VfsUtilCore.urlToPath(fileUri)
        val pathDirectory = VfsUtil.getParentDir(path)
            ?: return LOG.warn("Parent directory is null for $path")
        val vfsDirectory = VfsUtil.createDirectories(pathDirectory)
            ?: return LOG.warn("Could not create directories for $path")
        val pathFilename = VfsUtil.extractFileName(path)
            ?: return LOG.warn("Could not get filename for $path")
        runWriteAction {
            val newFile = vfsDirectory.createChildData(this, pathFilename)
            VfsUtil.saveText(newFile, content)
        }
    }

    /**
     * Apply a set of edits to a file using the Document API.
     * This preserves unsaved buffer changes and supports undo.
     *
     * @param fileUri The file URI to edit
     * @param edits List of edit maps with keys:
     *   - startLine / startCharacter: start position (0-based, inclusive)
          *   - endLine / endCharacter: end position (0-based, exclusive)
     *   - newText: replacement text
     */
    fun applyEdit(fileUri: String, edits: List<Map<String, Any>>): Boolean {
        val file = findFile(fileUri)
            ?: return false

        val document = FileDocumentManager.getInstance().getDocument(file)
            ?: return false

        com.intellij.openapi.command.WriteCommandAction.runWriteCommandAction(project) {
            // Apply edits in reverse order (by start offset) to avoid position conflicts
            val sortedEdits = edits.sortedByDescending { edit ->
                lineColumnToOffset(document, edit["startLine"] as? Int ?: 0, edit["startCharacter"] as? Int ?: 0)
            }

            for (edit in sortedEdits) {
                val startLine = edit["startLine"] as? Int ?: 0
                val startCharacter = edit["startCharacter"] as? Int ?: 0
                val endLine = edit["endLine"] as? Int ?: startLine
                val endCharacter = edit["endCharacter"] as? Int ?: startCharacter
                val newText = edit["newText"] as? String ?: continue

                val startOffset = lineColumnToOffset(document, startLine, startCharacter)
                val endOffset = lineColumnToOffset(document, endLine, endCharacter)

                if (startOffset >= 0 && endOffset >= startOffset && endOffset <= document.textLength) {
                    document.replaceString(startOffset, endOffset, newText)
                }
            }
        }
        return true
    }

    /** Convert 0-based line/character to a 0-based document offset. */
    private fun lineColumnToOffset(document: com.intellij.openapi.editor.Document, line: Int, character: Int): Int {
        if (line < 0 || line >= document.lineCount) return -1
        val lineStart = document.getLineStartOffset(line)
        val lineLength = document.getLineEndOffset(line) - document.getLineStartOffset(line)
        val clampedChar = character.coerceIn(0, lineLength)
        return lineStart + clampedChar
    }


    fun removeFile(fileUri: String) {
        val found = findFile(fileUri)
            ?: return LOG.warn("File not found: $fileUri")
        runWriteAction {
            found.delete(this)
        }
    }

    fun listDir(fileUri: String): List<List<Any>> {
        val found = findFile(fileUri)
            ?: return emptyList()
        if (!found.isDirectory)
            return emptyList()
        return found.children.map { file ->
            val fileType = if (file.isDirectory)
                FileType.DIRECTORY.value
            else
                FileType.FILE.value
            listOf(file.name, fileType)
        }
    }

    fun readFile(fileUri: String, maxLength: Int = 100_000): String {
        val found = findFile(fileUri)
            ?: return ""
        val text = runReadAction {
            // note: document (if exists) is more up-to-date than VFS
            readDocument(found, maxLength) ?: VfsUtil.loadText(found, maxLength)
        }
        return normalizeLineEndings(text)
    }

    fun openFile(fileUri: String) {
        val found = findFile(fileUri)
            ?: return
        FileEditorManager.getInstance(project).openFile(found, true)
    }

    fun saveFile(fileUri: String) {
        val found = findFile(fileUri)
            ?: return
        val manager = FileDocumentManager.getInstance()
        val document = manager.getDocument(found)
            ?: return
        manager.saveDocument(document)
    }

    fun getFileStats(fileUris: List<String>): Map<String, FileStats> =
        fileUris.mapNotNull { fileUri ->
            val file = findFile(fileUri)
                ?: return@mapNotNull null
            fileUri to FileStats(file.timeStamp, file.length)
        }.toMap()

    private fun findFile(fileUri: String): VirtualFile? {
        val noParams = fileUri.substringBefore("?")
        val normalizedAuthority = normalizeWindowsAuthority(noParams)
        return VirtualFileManager.getInstance()
            .refreshAndFindFileByUrl(normalizedAuthority)
    }

    private fun readDocument(file: VirtualFile, maxLength: Int): String? {
        val document = FileDocumentManager.getInstance().getDocument(file)
            ?: return null
        val length = min(document.textLength, maxLength)
        return document.getText(TextRange(0, length))
    }

    private fun normalizeLineEndings(text: String) =
        text.replace("\r\n", "\n")
            .replace("\r", "\n")

    private fun normalizeWindowsAuthority(fileUri: String): String {
        val authorityPrefix = "file://"
        val noAuthorityPrefix = "file:///"
        if (fileUri.startsWith(authorityPrefix) && !fileUri.startsWith(noAuthorityPrefix)) {
            val path = fileUri.substringAfter(authorityPrefix)
            return "$noAuthorityPrefix$path"
        }
        return fileUri
    }

    private companion object {
        private val LOG = Logger.getInstance(FileUtils::class.java)
    }
}