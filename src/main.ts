import {
	App,
	ButtonComponent,
	Command,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal,
} from "obsidian";

const LEADER_TIMEOUT_MS = 2000;

interface SerializedKeyStroke {
	key: string;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	meta: boolean;
}

interface ShortcutMapping {
	id: string;
	commandId: string;
	sequence: SerializedKeyStroke[];
}

interface LeaderKeySettings {
	leaderKey: SerializedKeyStroke | null;
	mappings: ShortcutMapping[];
}

const DEFAULT_SETTINGS: LeaderKeySettings = {
	leaderKey: null,
	mappings: [],
};

class KeyStroke {
	key: string;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	meta: boolean;

	constructor(key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) {
		this.key = normalizeKey(key);
		this.shift = shift;
		this.alt = alt;
		this.ctrl = ctrl;
		this.meta = meta;
	}

	static fromEvent(event: KeyboardEvent): KeyStroke {
		return new KeyStroke(event.key, event.shiftKey, event.altKey, event.ctrlKey, event.metaKey);
	}

	static fromJSON(value: SerializedKeyStroke): KeyStroke {
		return new KeyStroke(value.key, value.shift, value.alt, value.ctrl, value.meta);
	}

	toJSON(): SerializedKeyStroke {
		return {
			key: this.key,
			shift: this.shift,
			alt: this.alt,
			ctrl: this.ctrl,
			meta: this.meta,
		};
	}

	equals(other: KeyStroke): boolean {
		return (
			this.key === other.key &&
			this.shift === other.shift &&
			this.alt === other.alt &&
			this.ctrl === other.ctrl &&
			this.meta === other.meta
		);
	}

	hash(): string {
		return JSON.stringify(this.toJSON());
	}

	isModifierOnly(): boolean {
		return MODIFIER_KEYS.has(this.key);
	}

	displayText(): string {
		const parts: string[] = [];

		if (this.meta) {
			parts.push("Cmd");
		}
		if (this.ctrl) {
			parts.push("Ctrl");
		}
		if (this.alt) {
			parts.push("Alt");
		}
		if (this.shift) {
			parts.push("Shift");
		}

		parts.push(displayKeyName(this.key));
		return parts.join("+");
	}
}

class LeaderMatcher {
	private mappings: Array<{ mapping: ShortcutMapping; hashes: string[] }> = [];

	constructor(mappings: ShortcutMapping[]) {
		this.setMappings(mappings);
	}

	setMappings(mappings: ShortcutMapping[]) {
		this.mappings = mappings
			.filter((mapping) => mapping.commandId && mapping.sequence.length > 0)
			.map((mapping) => ({
				mapping,
				hashes: mapping.sequence.map((stroke) => KeyStroke.fromJSON(stroke).hash()),
			}));
	}

	evaluate(sequence: KeyStroke[]): { fullMatch: ShortcutMapping | null; partialMatch: boolean } {
		const input = sequence.map((stroke) => stroke.hash());
		let fullMatch: ShortcutMapping | null = null;
		let partialMatch = false;

		for (const entry of this.mappings) {
			if (input.length > entry.hashes.length) {
				continue;
			}

			const matchesPrefix = input.every((hash, index) => entry.hashes[index] === hash);
			if (!matchesPrefix) {
				continue;
			}

			if (input.length === entry.hashes.length) {
				fullMatch = entry.mapping;
			} else {
				partialMatch = true;
			}
		}

		return { fullMatch, partialMatch };
	}
}

export default class LeaderKeyPlugin extends Plugin {
	settings: LeaderKeySettings;

	private matcher = new LeaderMatcher([]);
	private activeSequence: KeyStroke[] = [];
	private leaderActivatedAt = 0;
	private statusBarItemEl: HTMLElement | null = null;
	private settingsTab: LeaderKeySettingTab | null = null;

	async onload() {
		await this.loadSettings();

		this.matcher.setMappings(this.settings.mappings);
		this.statusBarItemEl = this.addStatusBarItem();
		this.renderStatusBar();

		this.settingsTab = new LeaderKeySettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.registerDomEvent(document, "keydown", this.handleKeydown, { capture: true });
		this.registerDomEvent(document, "pointerdown", () => this.resetLeaderSequence());
		this.registerDomEvent(window, "blur", () => this.resetLeaderSequence());
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.hidden) {
				this.resetLeaderSequence();
			}
		});

		this.addCommand({
			id: "cancel-active-leader-sequence",
			name: "Cancel active leader sequence",
			callback: () => this.resetLeaderSequence(),
		});
	}

	async loadSettings() {
		const loaded = (await this.loadData()) as Partial<LeaderKeySettings> | null;
		this.settings = sanitizeSettings(loaded);
	}

	async saveSettings() {
		this.matcher.setMappings(this.settings.mappings);
		await this.saveData(this.settings);
		this.renderStatusBar();
		this.settingsTab?.display();
	}

	async setLeaderKey(key: KeyStroke | null) {
		this.settings.leaderKey = key?.toJSON() ?? null;
		this.resetLeaderSequence();
		await this.saveSettings();
	}

	async upsertMapping(mapping: ShortcutMapping) {
		const existingIndex = this.settings.mappings.findIndex((entry) => entry.id === mapping.id);
		if (existingIndex >= 0) {
			this.settings.mappings[existingIndex] = mapping;
		} else {
			this.settings.mappings.push(mapping);
		}

		await this.saveSettings();
	}

	async removeMapping(mappingId: string) {
		this.settings.mappings = this.settings.mappings.filter((mapping) => mapping.id !== mappingId);
		await this.saveSettings();
	}

	createEmptyMapping(): ShortcutMapping {
		return {
			id: createMappingId(),
			commandId: "",
			sequence: [],
		};
	}

	getLeaderKey(): KeyStroke | null {
		return this.settings.leaderKey ? KeyStroke.fromJSON(this.settings.leaderKey) : null;
	}

	getCommandOptions(): Command[] {
		const commandMap = getCommandManager(this.app).commands;
		return Object.values(commandMap).sort((left, right) => left.name.localeCompare(right.name));
	}

	getCommandName(commandId: string): string {
		if (!commandId) {
			return "No command selected";
		}

		return getCommandManager(this.app).commands[commandId]?.name ?? commandId;
	}

	private readonly handleKeydown = (event: KeyboardEvent) => {
		if (event.isComposing || event.key === "Process") {
			return;
		}

		const leaderKey = this.getLeaderKey();
		if (!leaderKey) {
			return;
		}

		if (event.repeat) {
			if (this.isLeaderActive()) {
				this.consumeKeyEvent(event);
			}
			return;
		}

		const stroke = KeyStroke.fromEvent(event);
		if (stroke.isModifierOnly()) {
			return;
		}

		if (this.isLeaderActive() && this.sequenceExpired()) {
			this.resetLeaderSequence();
		}

		if (!this.isLeaderActive()) {
			if (!stroke.equals(leaderKey)) {
				return;
			}

			this.activateLeaderMode();
			this.consumeKeyEvent(event);
			return;
		}

		this.consumeKeyEvent(event);
		this.activeSequence.push(stroke);
		this.leaderActivatedAt = Date.now();

		const result = this.matcher.evaluate(this.activeSequence);
		if (result.fullMatch) {
			const commandId = result.fullMatch.commandId;
			this.resetLeaderSequence();
			this.executeCommand(commandId);
			return;
		}

		if (result.partialMatch) {
			this.renderStatusBar();
			return;
		}

		this.resetLeaderSequence();
	};

	private executeCommand(commandId: string) {
		const commandManager = getCommandManager(this.app);
		const didRun = commandManager.executeCommandById(commandId);
		if (!didRun) {
			new Notice(`Leader Key could not run command: ${this.getCommandName(commandId)}`);
		}
	}

	private activateLeaderMode() {
		this.activeSequence = [];
		this.leaderActivatedAt = Date.now();
		this.renderStatusBar();
	}

	private isLeaderActive(): boolean {
		return this.leaderActivatedAt > 0;
	}

	private sequenceExpired(): boolean {
		return Date.now() - this.leaderActivatedAt > LEADER_TIMEOUT_MS;
	}

	private resetLeaderSequence() {
		this.activeSequence = [];
		this.leaderActivatedAt = 0;
		this.renderStatusBar();
	}

	private renderStatusBar() {
		if (!this.statusBarItemEl) {
			return;
		}

		if (!this.isLeaderActive()) {
			this.statusBarItemEl.setText("");
			return;
		}

		const suffix = this.activeSequence.map((stroke) => stroke.displayText()).join(" ");
		const label = suffix ? `Leader: ${suffix}` : "Leader: waiting for keys";
		this.statusBarItemEl.setText(label);
	}

	private consumeKeyEvent(event: KeyboardEvent) {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}
}

class LeaderKeySettingTab extends PluginSettingTab {
	plugin: LeaderKeyPlugin;

	constructor(app: App, plugin: LeaderKeyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Leader Key" });
		containerEl.createEl("p", {
			text: "Leader shortcuts always begin with the leader key, followed by the stored suffix sequence for a command.",
		});

		const leaderSetting = new Setting(containerEl)
			.setName("Leader key")
			.setDesc("Choose the key combination that starts every leader shortcut.");

		const leaderPreview = leaderSetting.controlEl.createDiv();
		leaderPreview.addClass("leader-key-sequence");
		renderKeySequence(
			leaderPreview,
			this.plugin.settings.leaderKey ? [KeyStroke.fromJSON(this.plugin.settings.leaderKey)] : [],
			"No leader key configured",
		);

		leaderSetting
			.addButton((button) =>
				button.setButtonText("Record leader key").onClick(() => {
					new KeySequenceRecorderModal(this.app, {
						title: "Record leader key",
						description: "Press the key combination that should act as the leader key.",
						mode: "single",
						onSubmit: async (sequence) => {
							await this.plugin.setLeaderKey(sequence[0] ?? null);
						},
					}).open();
				}),
			)
			.addExtraButton((button) =>
				button
					.setIcon("cross")
					.setTooltip("Clear leader key")
					.onClick(async () => {
						await this.plugin.setLeaderKey(null);
					}),
			);

		containerEl.createEl("h2", { text: "Shortcut mappings" });
		containerEl.createEl("p", {
			text: "Each mapping pairs an Obsidian command with the key sequence pressed after the leader key.",
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add shortcut").setCta().onClick(async () => {
				await this.plugin.upsertMapping(this.plugin.createEmptyMapping());
			}),
		);

		const listEl = containerEl.createDiv({ cls: "leader-key-mapping-list" });
		for (const mapping of this.plugin.settings.mappings) {
			this.renderMappingCard(listEl, mapping);
		}

		if (this.plugin.settings.mappings.length === 0) {
			listEl.createEl("p", {
				text: "No shortcuts configured yet.",
			});
		}
	}

	private renderMappingCard(containerEl: HTMLElement, mapping: ShortcutMapping) {
		const cardEl = containerEl.createDiv({ cls: "leader-key-mapping-card" });
		const headerEl = cardEl.createDiv({ cls: "leader-key-mapping-header" });
		const textEl = headerEl.createDiv();
		textEl.createDiv({
			cls: "leader-key-mapping-title",
			text: this.plugin.getCommandName(mapping.commandId),
		});
		textEl.createDiv({
			cls: "leader-key-mapping-meta",
			text: mapping.commandId ? mapping.commandId : "No command selected",
		});

		const actionsEl = headerEl.createDiv();
		this.addActionButton(actionsEl, "Choose command", async () => {
			new CommandPickerModal(this.app, this.plugin.getCommandOptions(), async (command) => {
				await this.plugin.upsertMapping({
					...mapping,
					commandId: command.id,
				});
			}).open();
		});
		this.addActionButton(actionsEl, "Record keys", () => {
			new KeySequenceRecorderModal(this.app, {
				title: "Record suffix sequence",
				description: "Press the keys that should run after the leader key.",
				mode: "sequence",
				initialSequence: mapping.sequence.map((stroke) => KeyStroke.fromJSON(stroke)),
				onSubmit: async (sequence) => {
					await this.plugin.upsertMapping({
						...mapping,
						sequence: sequence.map((stroke) => stroke.toJSON()),
					});
				},
			}).open();
		});
		this.addActionButton(actionsEl, "Remove", async () => {
			await this.plugin.removeMapping(mapping.id);
		});

		const sequenceEl = cardEl.createDiv({ cls: "leader-key-sequence" });
		const leaderKey = this.plugin.getLeaderKey();
		const suffix = mapping.sequence.map((stroke) => KeyStroke.fromJSON(stroke));
		const leaderSequence = leaderKey ? [leaderKey] : [];
		renderCombinedSequence(sequenceEl, leaderSequence, suffix);
	}

	private addActionButton(containerEl: HTMLElement, text: string, onClick: () => void | Promise<void>) {
		new ButtonComponent(containerEl).setButtonText(text).onClick(onClick);
	}
}

type RecorderMode = "single" | "sequence";

class KeySequenceRecorderModal extends Modal {
	private readonly title: string;
	private readonly description: string;
	private readonly mode: RecorderMode;
	private readonly onSubmit: (sequence: KeyStroke[]) => Promise<void> | void;
	private sequence: KeyStroke[];
	private sequenceEl: HTMLElement | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(
		app: App,
		options: {
			title: string;
			description: string;
			mode: RecorderMode;
			initialSequence?: KeyStroke[];
			onSubmit: (sequence: KeyStroke[]) => Promise<void> | void;
		},
	) {
		super(app);
		this.title = options.title;
		this.description = options.description;
		this.mode = options.mode;
		this.sequence = options.initialSequence ? [...options.initialSequence] : [];
		this.onSubmit = options.onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.description });

		const helpText =
			this.mode === "single"
				? "The first non-modifier key combination will be recorded immediately."
				: "Press keys to add them to the suffix sequence, then click Save.";
		contentEl.createEl("p", { text: helpText });

		this.sequenceEl = contentEl.createDiv({ cls: "leader-key-sequence" });
		this.renderSequence();

		const modalControls = new Setting(contentEl);
		if (this.mode === "single") {
			modalControls.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			);
		} else {
			modalControls
				.addButton((button) =>
					button
						.setButtonText("Save")
						.setCta()
						.onClick(async () => {
							if (this.sequence.length === 0) {
								new Notice("Record at least one key for this mapping.");
								return;
							}

							await this.onSubmit([...this.sequence]);
							this.close();
						}),
				)
				.addButton((button) =>
					button.setButtonText("Remove last").onClick(() => {
						this.sequence.pop();
						this.renderSequence();
					}),
				)
				.addButton((button) =>
					button.setButtonText("Clear").onClick(() => {
						this.sequence = [];
						this.renderSequence();
					}),
				)
				.addButton((button) =>
					button.setButtonText("Cancel").onClick(() => {
						this.close();
					}),
				);
		}

		this.keydownHandler = (event: KeyboardEvent) => {
			if (event.isComposing || event.key === "Process" || event.repeat) {
				return;
			}

			const stroke = KeyStroke.fromEvent(event);
			if (stroke.isModifierOnly()) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			if (this.mode === "single") {
				void this.onSubmit([stroke]);
				this.close();
				return;
			}

			this.sequence.push(stroke);
			this.renderSequence();
		};

		document.addEventListener("keydown", this.keydownHandler, true);
	}

	onClose() {
		this.contentEl.empty();
		if (this.keydownHandler) {
			document.removeEventListener("keydown", this.keydownHandler, true);
			this.keydownHandler = null;
		}
	}

	private renderSequence() {
		if (!this.sequenceEl) {
			return;
		}

		const emptyText =
			this.mode === "single" ? "Waiting for a key combination..." : "No keys recorded yet.";
		renderKeySequence(this.sequenceEl, this.sequence, emptyText);
	}
}

class CommandPickerModal extends SuggestModal<Command> {
	private readonly commands: Command[];
	private readonly onChoose: (command: Command) => Promise<void> | void;

	constructor(app: App, commands: Command[], onChoose: (command: Command) => Promise<void> | void) {
		super(app);
		this.commands = commands;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a command");
	}

	getSuggestions(query: string): Command[] {
		const normalizedQuery = query.toLowerCase();
		return this.commands.filter((command) => {
			return (
				command.name.toLowerCase().includes(normalizedQuery) ||
				command.id.toLowerCase().includes(normalizedQuery)
			);
		});
	}

	renderSuggestion(command: Command, el: HTMLElement): void {
		el.createDiv({ text: command.name });
		el.createDiv({
			cls: "leader-key-mapping-meta",
			text: command.id,
		});
	}

	onChooseSuggestion(command: Command): void {
		void this.onChoose(command);
	}
}

function renderCombinedSequence(
	containerEl: HTMLElement,
	leader: KeyStroke[],
	suffix: KeyStroke[],
) {
	containerEl.empty();

	if (leader.length === 0 && suffix.length === 0) {
		containerEl.createSpan({ text: "No keys recorded" });
		return;
	}

	appendKeySequence(containerEl, leader);
	if (leader.length > 0 && suffix.length > 0) {
		containerEl.createSpan({
			cls: "leader-key-sequence-arrow",
			text: "then",
		});
	}
	if (suffix.length > 0) {
		if (leader.length > 0) {
			containerEl.createSpan({
				cls: "leader-key-sequence-arrow",
				text: "→",
			});
		}
		appendKeySequence(containerEl, suffix);
	}
}

function renderKeySequence(containerEl: HTMLElement, sequence: KeyStroke[], emptyText: string) {
	containerEl.empty();

	if (sequence.length === 0) {
		containerEl.createSpan({ text: emptyText });
		return;
	}

	appendKeySequence(containerEl, sequence);
}

function appendKeySequence(containerEl: HTMLElement, sequence: KeyStroke[]) {
	sequence.forEach((stroke, index) => {
		containerEl.createSpan({
			cls: "leader-key-pill",
			text: stroke.displayText(),
		});
		if (index < sequence.length - 1) {
			containerEl.createSpan({
				cls: "leader-key-sequence-arrow",
				text: "→",
			});
		}
	});
}

function sanitizeSettings(loaded: Partial<LeaderKeySettings> | null | undefined): LeaderKeySettings {
	const leaderKey = isSerializedKeyStroke(loaded?.leaderKey) ? loaded.leaderKey : DEFAULT_SETTINGS.leaderKey;
	const mappings = Array.isArray(loaded?.mappings)
		? loaded.mappings
				.map(sanitizeMapping)
				.filter((mapping): mapping is ShortcutMapping => mapping !== null)
		: DEFAULT_SETTINGS.mappings;

	return {
		leaderKey,
		mappings,
	};
}

function sanitizeMapping(value: unknown): ShortcutMapping | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const mapping = value as Partial<ShortcutMapping>;
	const sequence = Array.isArray(mapping.sequence)
		? mapping.sequence.filter(isSerializedKeyStroke)
		: [];

	return {
		id: typeof mapping.id === "string" && mapping.id.length > 0 ? mapping.id : createMappingId(),
		commandId: typeof mapping.commandId === "string" ? mapping.commandId : "",
		sequence,
	};
}

function isSerializedKeyStroke(value: unknown): value is SerializedKeyStroke {
	if (!value || typeof value !== "object") {
		return false;
	}

	const stroke = value as Partial<SerializedKeyStroke>;
	return (
		typeof stroke.key === "string" &&
		typeof stroke.shift === "boolean" &&
		typeof stroke.alt === "boolean" &&
		typeof stroke.ctrl === "boolean" &&
		typeof stroke.meta === "boolean"
	);
}

function createMappingId(): string {
	return `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKey(key: string): string {
	if (key === " ") {
		return "Space";
	}

	switch (key) {
		case "Esc":
			return "Escape";
		case "Del":
			return "Delete";
		case "Left":
			return "ArrowLeft";
		case "Right":
			return "ArrowRight";
		case "Up":
			return "ArrowUp";
		case "Down":
			return "ArrowDown";
		default:
			break;
	}

	return key.length === 1 ? key.toLowerCase() : key;
}

function displayKeyName(key: string): string {
	if (key === " ") {
		return "Space";
	}

	return key;
}

type CommandManager = {
	commands: Record<string, Command>;
	executeCommandById(commandId: string): boolean;
};

function getCommandManager(app: App): CommandManager {
	return (app as App & { commands: CommandManager }).commands;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Meta", "Alt", "AltGraph"]);
