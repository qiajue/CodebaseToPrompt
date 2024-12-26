# CodebaseToPrompt

Convert any local directory into a structured XML prompt for Large Language Models (LLMs). This tool helps you prepare codebases for analysis, code review, or documentation generation using AI models.

## 🚀 Features

- **Interactive File Tree**: Visual interface to select/deselect files and folders
- **Smart File Detection**: Automatically identifies and filters binary files
- **Configurable Ignore Rules**: Built-in support for common ignore patterns (node_modules, .git, etc.)
- **XML Output**: Generates clean, structured XML format ideal for LLM prompts
- **Local Processing**: All processing happens in your browser - no files are uploaded
- **Persistence**: Saves your selections between sessions
- **Keyboard Navigation**: Full keyboard support for power users

## 🛠️ Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/path-find-er/CodebaseToPrompt.git
   ```

2. Open `index.html` in a browser (Chrome, Firefox recommended)
3. Click "Select Directory" to choose your project folder
4. Select the files you want to include in your prompt
5. Copy the generated XML output

## 💡 Use Cases

- Generate comprehensive code documentation
- Prepare codebases for AI-powered code review
- Create context for LLM-based code analysis
- Extract specific parts of your project for focused AI assistance
- Prepare training data for fine-tuning code models

## 🔧 Configuration

Common ignore patterns are built-in, including:
- `node_modules`
- `.git`
- `venv`
- `__pycache__`
- `.idea`
- `.vscode`
- Binary and system files

## 🌐 Browser Support

- Chrome/Chromium (recommended)
- Edge
- Firefox
- Safari (limited directory selection support)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📝 License

[MIT](LICENSE)

## 🙏 Acknowledgments

- Built with vanilla JavaScript and modern browser APIs
- Inspired by the need for better tooling in AI-assisted development

## 🔮 Future Plans

- [ ] Custom ignore patterns
- [ ] Multiple output formats
- [ ] File content preview
- [ ] Size optimization options
- [ ] Integration with popular LLM platforms
- [ ] CLI version

## 📫 Contact

- Create an issue for bug reports or feature requests
- Submit PRs for direct contributions
