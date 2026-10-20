# Xave

A notebook, a board and a week planner that live in one file on your computer.
No account, no sign up, no internet needed.

![The notes screen](docs/screenshot-notes.png)

## What this is

Xave is a small program you open in your browser. It keeps your notes, holds a
pinboard of cards you can move around, and plans your week. Everything you write is
saved on your own computer, inside the browser. Nothing is uploaded, and there is no
account to create.

- One file, double click to open. Nothing to install.
- Works with no internet. Airplane mode is fine.
- Your notes never leave your computer.
- Free and open source.

## Open it (two minutes)

1. Near the top of this page, press the green **Code** button, then **Download ZIP**.
2. Unzip the folder anywhere you like, for example on your Desktop.
3. Double click **index.html**. It opens in your browser and is ready to use.

That is the whole setup. Keep the folder where it is. You can move it, copy it to a
USB stick, or keep a second copy on another computer.

> **First time?** The app opens with a short *Getting started* note that shows you
> around. Delete it whenever you like.

## Write notes

Folders on the left, your note on the right. Bold, italic, headings, lists, tickable
checkboxes and tables sit in the small toolbar above the text. Press **Ctrl K** to
search everything you have written.

## Keep a board of cards

Press **Boards** in the left rail. A board is a free canvas: notes, to dos, links,
photos, files, drawings and comments, wherever you like. Drag them, resize them,
group them, draw on them. Press **Fit** to bring everything back into view.

![A board with cards](docs/screenshot-board.png)

## Plan your week

Inside a board, press **Planner**. Add a block to a day, drag it to another hour, and
it stays where you put it. Day, week, month and year are at the top.

![The week planner](docs/screenshot-planner.png)

## Undo what you did not mean

**Ctrl Z** on a board puts back the last thing you removed, together with the photo
or file that was on it. The message that appears after a delete has an **Undo**
button too.

## Make it yours

The moon icon at the top right switches to dark mode. Settings, the sliders icon,
has colour themes and a text size.

![Dark mode](docs/screenshot-dark.png)

## Your notes stay on your computer

Everything is stored inside your browser, on this machine. Nothing is sent anywhere.
That also means:

- Clearing your browser data, or running a "clean up" tool, can delete your notes.
- A different browser, or a different computer, starts with an empty notebook.

Please make a backup now and then.

### Back up

1. Press the sliders icon at the top right to open **Settings**.
2. Press **Export everything**. One file is saved and it holds all of your notes.
3. Keep that file somewhere safe: another drive, a USB stick, or your cloud storage.

To come back later, or to move to another computer: open the app, **Settings**,
**Import a bundle**, then pick that file. **Export .db file** saves a copy that
database programs can read, which is useful for very long term storage.

## Common questions

**Does it need internet?** No. Once the page is on your computer it works offline.

**Which browser?** Chrome, Edge, Firefox or Safari, recent versions. Chrome and Edge
are the smoothest.

**Do I need to install anything?** No. There is no installer and no account.

**Can I use it on my phone?** Yes. Put the folder on the phone and open index.html
with a file manager, or host it online (below) and add it to your home screen.

**Where are my notes kept?** Not inside index.html. Your browser stores them for this
page, so keep the file where it is and open that same file each time.

**Is my data private?** Yes. Nothing leaves your computer and there is no server.

## Optional: put it online

If you want one link you can open from any device, publish the folder:

1. Put this folder in a GitHub repository.
2. Open the repository **Settings**, then **Pages**.
3. Choose **Deploy from a branch**, branch **main**, folder **/(root)**, then Save.
4. After a minute the app is at `https://<your name>.github.io/<repository>/`.

The page is public, but nobody sees your notes: each visitor gets an empty notebook
stored in their own browser.

## For developers

The readable source is in `src/`. `index.html` at the root is the built app that
everyone downloads, so rebuild it with `node tools/build.js` and commit it along with
your change. Architecture, storage details, test scripts and every command are in
[docs/DEVELOPERS.md](docs/DEVELOPERS.md).

The screenshots in `docs/` are the real app, not mockups.

## License

MIT.
