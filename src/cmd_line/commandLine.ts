import * as vscode from 'vscode';
import { CommandLineHistory } from '../history/historyFile';
import { Mode } from './../mode/mode';
import { Logger } from '../util/logger';
import { StatusBar } from '../statusBar';
import { VimError, ErrorCode } from '../error';
import { VimState } from '../state/vimState';
import { configuration } from '../configuration/configuration';
import { Register } from '../register/register';
import { RecordedState } from '../state/recordedState';
import { exCommandParser } from '../vimscript/exCommandParser';

class CommandLine {
  private history!: CommandLineHistory;
  private readonly logger = Logger.get('CommandLine');

  /**
   *  Index used for navigating commandline history with <up> and <down>
   */
  public commandLineHistoryIndex: number = 0;

  /**
   * for checking the last pressed key in command mode
   */
  public lastKeyPressed = '';

  public autoCompleteIndex = 0;
  public autoCompleteItems: string[] = [];
  public preCompleteCharacterPos = 0;
  public preCompleteCommand = '';

  public get historyEntries() {
    return this.history?.get() || [];
  }

  public previousMode = Mode.Normal;

  public async load(context: vscode.ExtensionContext): Promise<void> {
    this.history = new CommandLineHistory(context);
    return this.history.load();
  }

  public async Run(commandName: string, vimState: VimState): Promise<void> {
    if (!commandName || commandName.length === 0) {
      return;
    }

    this.history.add(commandName);
    this.commandLineHistoryIndex = this.history.get().length;

    if (!commandName.startsWith('reg')) {
      const recState = new RecordedState();
      recState.registerName = ':';
      recState.commandList = commandName.split('');
      Register.setReadonlyRegister(':', recState);
    }

    try {
      const { lineRange, command } = exCommandParser.tryParse(commandName);
      const useNeovim = configuration.enableNeovim && command.neovimCapable();

      if (useNeovim && vimState.nvim) {
        const { statusBarText, error } = await vimState.nvim.run(vimState, commandName);
        StatusBar.setText(vimState, statusBarText, error);
      } else {
        if (lineRange) {
          await command.executeWithRange(vimState, lineRange);
        } else {
          await command.execute(vimState);
        }
      }
    } catch (e) {
      if (e instanceof VimError) {
        if (
          e.code === ErrorCode.NotAnEditorCommand &&
          configuration.enableNeovim &&
          vimState.nvim
        ) {
          const { statusBarText } = await vimState.nvim.run(vimState, commandName);
          StatusBar.setText(vimState, statusBarText, true);
        } else {
          StatusBar.setText(vimState, e.toString(), true);
        }
      } else {
        this.logger.error(`Error executing cmd=${commandName}. err=${e}.`);
      }
    }
  }

  /**
   * Prompts the user for a command using an InputBox, and runs the provided command
   */
  public async PromptAndRun(initialText: string, vimState: VimState): Promise<void> {
    const cmd = await vscode.window.showInputBox(this.getInputBoxOptions(initialText));
    await this.Run(cmd!, vimState);
  }

  private getInputBoxOptions(text: string): vscode.InputBoxOptions {
    return {
      prompt: 'Vim command line',
      value: text,
      ignoreFocusOut: false,
      valueSelection: [text.length, text.length],
    };
  }

  public async showHistory(initialText: string): Promise<string | undefined> {
    this.history.add(initialText);

    return vscode.window.showQuickPick(this.history.get().slice().reverse(), {
      placeHolder: 'Vim command history',
      ignoreFocusOut: false,
    });
  }
}

export const commandLine = new CommandLine();
