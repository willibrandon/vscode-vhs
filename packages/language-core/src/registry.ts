import themes from "../../../data/themes.json" with { type: "json" };
import type { CommandDefinition, SettingDefinition } from "./types.js";

const docs = "https://github.com/charmbracelet/vhs#vhs-command-reference";

const command = (
  name: string,
  syntax: string,
  description: string,
  argumentsKind: CommandDefinition["arguments"],
  action = true,
  since = "0.1.0",
): CommandDefinition => ({
  name,
  syntax,
  description,
  documentation: docs,
  since,
  arguments: argumentsKind,
  action,
});

export const COMMANDS: readonly CommandDefinition[] = [
  command("Set", "Set <Setting> <Value>", "Changes a VHS recording setting.", "none", false),
  command("Sleep", "Sleep <Duration>", "Waits for a fixed duration.", "duration"),
  command("Type", "Type[@<Duration>] <Text>", "Types text into the terminal.", "string"),
  command("Enter", "Enter[@<Duration>] [Count]", "Presses Enter.", "number"),
  command("Space", "Space[@<Duration>] [Count]", "Presses Space.", "number"),
  command("Backspace", "Backspace[@<Duration>] [Count]", "Presses Backspace.", "number"),
  command("Delete", "Delete[@<Duration>] [Count]", "Presses Delete.", "number"),
  command("Insert", "Insert[@<Duration>] [Count]", "Presses Insert.", "number"),
  command("Ctrl", "Ctrl[+Alt][+Shift]+<Key>", "Presses a control-key combination.", "string"),
  command("Alt", "Alt+<Key>", "Presses an Alt-key combination.", "string"),
  command("Shift", "Shift+<Key>", "Presses a Shift-key combination.", "string"),
  command("Down", "Down[@<Duration>] [Count]", "Presses the down arrow.", "number"),
  command("Left", "Left[@<Duration>] [Count]", "Presses the left arrow.", "number"),
  command("Right", "Right[@<Duration>] [Count]", "Presses the right arrow.", "number"),
  command("Up", "Up[@<Duration>] [Count]", "Presses the up arrow.", "number"),
  command("PageUp", "PageUp[@<Duration>] [Count]", "Presses Page Up.", "number"),
  command("PageDown", "PageDown[@<Duration>] [Count]", "Presses Page Down.", "number"),
  command("ScrollUp", "ScrollUp [Count]", "Scrolls the terminal up.", "number", true, "0.11.0"),
  command(
    "ScrollDown",
    "ScrollDown [Count]",
    "Scrolls the terminal down.",
    "number",
    true,
    "0.11.0",
  ),
  command("Tab", "Tab[@<Duration>] [Count]", "Presses Tab.", "number"),
  command("Escape", "Escape[@<Duration>] [Count]", "Presses Escape.", "number"),
  command("Hide", "Hide", "Stops recording terminal frames while commands continue.", "none"),
  command(
    "Require",
    "Require <Executable>",
    "Stops when an executable is unavailable.",
    "string",
    false,
  ),
  command("Show", "Show", "Resumes recording terminal frames.", "none"),
  command("Output", "Output <Path>", "Adds a rendered output artifact.", "path", false),
  command(
    "Wait",
    "Wait[+Line|+Screen][@<Duration>] [/Pattern/]",
    "Waits for terminal output.",
    "regex",
  ),
  command("Source", "Source <Path.tape>", "Includes commands from another tape.", "path", false),
  command("Screenshot", "Screenshot <Path.png>", "Captures the next rendered frame.", "path"),
  command("Copy", "Copy <Text>", "Copies text to the VHS clipboard.", "string"),
  command("Paste", "Paste", "Pastes the VHS clipboard into the terminal.", "none"),
  command(
    "Env",
    "Env <Name> <Value>",
    "Sets an environment variable for the terminal.",
    "string",
    false,
  ),
];

const setting = (
  name: string,
  syntax: string,
  description: string,
  value: SettingDefinition["value"],
  defaultValue: string,
  values?: readonly string[],
): SettingDefinition => ({
  name,
  syntax: `Set ${name} ${syntax}`,
  description,
  documentation: docs,
  since: "0.1.0",
  value,
  defaultValue,
  ...(values === undefined ? {} : { values }),
});

export const SHELLS: readonly string[] = [
  "bash",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "nu",
  "osh",
  "xonsh",
];

export const WINDOW_BARS: readonly string[] = [
  "",
  "Colorful",
  "ColorfulRight",
  "Rings",
  "RingsRight",
];
export const THEMES: readonly string[] = ["Charmbracelet", ...themes.names];

export const SETTINGS: readonly SettingDefinition[] = [
  setting("Shell", "<Shell>", "Selects the terminal shell.", "shell", "bash", SHELLS),
  setting("FontFamily", "<Name>", "Sets the terminal font family.", "string", "monospace"),
  setting(
    "MarginFill",
    "<Color>",
    "Sets the color outside the terminal frame.",
    "color",
    "#000000",
  ),
  setting("Margin", "<Pixels>", "Sets the frame margin.", "number", "0"),
  setting(
    "WindowBar",
    "<Style>",
    "Selects the window-bar decoration.",
    "windowBar",
    "",
    WINDOW_BARS,
  ),
  setting("WindowBarSize", "<Pixels>", "Sets the window-bar height.", "number", "30"),
  setting("BorderRadius", "<Pixels>", "Rounds the terminal corners.", "number", "0"),
  setting("FontSize", "<Pixels>", "Sets terminal text size.", "number", "22"),
  setting("Framerate", "<FramesPerSecond>", "Sets the output frame rate.", "number", "60"),
  setting("Height", "<Pixels>", "Sets terminal height.", "number", "600"),
  setting("LetterSpacing", "<Pixels>", "Sets character spacing.", "number", "1"),
  setting("LineHeight", "<Multiplier>", "Sets line-height spacing.", "number", "1"),
  setting("PlaybackSpeed", "<Multiplier>", "Changes output playback speed.", "number", "1"),
  setting(
    "TypingSpeed",
    "<Duration>",
    "Sets the delay between typed characters.",
    "duration",
    "50ms",
  ),
  setting("Padding", "<Pixels>", "Sets padding inside the terminal frame.", "number", "60"),
  setting(
    "Theme",
    "<Name|JSON>",
    "Selects a built-in or custom terminal theme.",
    "theme",
    "Charmbracelet",
    THEMES,
  ),
  setting("Width", "<Pixels>", "Sets terminal width.", "number", "1200"),
  setting("LoopOffset", "<Percent>", "Crossfades the end of a looping GIF.", "number", "0%"),
  setting("WaitTimeout", "<Duration>", "Limits how long Wait can block.", "duration", "15s"),
  setting("WaitPattern", "/<Pattern>/", "Sets the default Wait regular expression.", "regex", ">$"),
  setting("CursorBlink", "<Boolean>", "Enables or disables cursor blinking.", "boolean", "true", [
    "true",
    "false",
  ]),
];

export const COMMAND_BY_NAME: ReadonlyMap<string, CommandDefinition> = new Map(
  COMMANDS.map((entry): readonly [string, CommandDefinition] => [entry.name, entry]),
);

export const SETTING_BY_NAME: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS.map((entry): readonly [string, SettingDefinition] => [entry.name, entry]),
);
