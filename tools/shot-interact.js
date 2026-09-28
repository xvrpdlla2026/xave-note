/**
 * shot-interact.js — behavioural checks for the tree interactions the redesign touched.
 *
 * Driven by tools/browser-check.js against the real index.html. Returns a string of
 * key=value assertions; anything that does not hold shows up as a `false`.
 */

window.__CHECK__ = function () {
  var App = window.NoteApp;
  if (!App || !App.app) return 'no app';

  return App.app.ready().then(function () {
    return App.db.createFolder(App.app.state.workspaceId, 'Interact parent', null).then(function (parent) {
      App.app.state.expanded[parent.id] = true;
      return App.db.createFolder(App.app.state.workspaceId, 'Interact child', parent.id);
    }).then(function () {
      App.app.render();
      var out = [];
      var log = function (k, v) { out.push(k + '=' + v); return v; };

      var rowByLabel = function (label) {
        var rows = Array.prototype.slice.call(document.querySelectorAll('#tree .tree__row'));
        return rows.filter(function (r) {
          var l = r.querySelector('.tree__label');
          return l && l.textContent === label;
        })[0] || null;
      };

      // Expand the seeded folder so nesting (and therefore the hover cascade) is present
      // in the default profile, not only in the screenshot profile.
      var seeded = rowByLabel('Getting started');
      if (seeded && seeded.getAttribute('aria-expanded') === 'false') {
        seeded.querySelector('.tree__twisty').click();
      }
      log('seedFolderExpanded', !!document.querySelector('#tree .tree__row--folder.is-expanded'));

      // ---- twisty: expands without also selecting the folder
      var parent = rowByLabel('Interact parent');
      log('parentFound', !!parent);
      var wasActive = parent.getAttribute('aria-selected');
      parent.querySelector('.tree__twisty').click();
      var afterTwisty = rowByLabel('Interact parent');
      log('collapsedAfterTwistyClick', afterTwisty.getAttribute('aria-expanded') === 'false');
      log('selectionUnchangedByTwisty', afterTwisty.getAttribute('aria-selected') === wasActive);
      log('childHiddenWhenCollapsed', !rowByLabel('Interact child'));

      // ---- row click still selects
      afterTwisty.click();
      var afterRow = rowByLabel('Interact parent');
      log('rowClickSelects', App.app.state.selection.id === afterRow.getAttribute('data-id'));
      log('ariaSelectedMirrorsState', afterRow.getAttribute('aria-selected') === 'true');
      // The whole row toggles, so a press on it opens the folder it names.
      log('rowClickExpandsFolder', afterRow.getAttribute('aria-expanded') === 'true');
      log('rowClickRevealedChild', !!rowByLabel('Interact child'));
      log('chevronShowsPressedState', afterRow.querySelector('.tree__twisty').classList.contains('is-expanded'));
      // Pressing the row again closes it - that is the toggle the arrow used to own.
      afterRow.click();
      log('secondRowClickCollapses', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'false');

      // The arrow remains the precision control: it toggles without moving the selection.
      var selectionBefore = JSON.stringify(App.app.state.selection);
      var arrowRow = rowByLabel('Interact parent');
      arrowRow.querySelector('.tree__twisty').click();
      log('arrowTogglesWithoutSelecting', JSON.stringify(App.app.state.selection) === selectionBefore);
      log('arrowToggledFolder', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'true');

      // ---- keyboard: Right expands, Left collapses
      var afterRow = rowByLabel('Interact parent');
      afterRow.focus();
      var press = function (key) {
        afterRow.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
      };
      press('ArrowRight');
      log('arrowRightExpands', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'true');
      var reopened = rowByLabel('Interact parent');
      // Right again steps into the first child rather than re-toggling.
      reopened.focus();
      reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      log('arrowRightStepsIntoChild', document.activeElement === rowByLabel('Interact child'));
      var child = rowByLabel('Interact child');
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      log('arrowLeftStepsOutToParent', document.activeElement === rowByLabel('Interact parent'));
      var collapsed = rowByLabel('Interact parent');
      collapsed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      log('arrowLeftCollapses', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'false');

      // ---- hidden twisty is out of the tab order (the row carries the keys instead)
      log('twistyNotTabbable', rowByLabel('Interact parent').querySelector('.tree__twisty').tabIndex === -1);

      // ---- the narrow-viewport pane class must never leak onto a wide viewport
      var layout = document.querySelector('.layout');
      var mq = window.matchMedia('(max-width: 820px)').matches;
      log('narrowViewport', mq);
      log('mobilePaneClassScopedToNarrow', layout.classList.contains('is-mobile-list') === mq);

      // ---- tree rhythm: CSSOM-level checks, because this harness cannot observe a live
      // style mutation on a re-rendered element (an inline background set immediately
      // before getComputedStyle still reads transparent). What can be checked is that the
      // spacing and hover rules exist, parse, and select what they claim to.
      var sheetRules = [];
      Array.prototype.forEach.call(document.styleSheets, function (sheet) {
        try {
          Array.prototype.forEach.call(sheet.cssRules, function (rule) { sheetRules.push(rule); });
        } catch (e) { /* cross-origin sheet, none here */ }
      });
      var ruleText = sheetRules.map(function (r) { return r.selectorText || ''; });
      var findRule = function (selector) {
        return sheetRules.filter(function (r) { return r.selectorText === selector; })[0] || null;
      };
      log('gapRuleExists', !!findRule('.tree__row + .tree__row'));
      log('groupGapRuleExists', !!findRule('.tree__row + .tree__row--group-start'));
      log('hoverCascadeRuleExists', !!findRule('.tree__row--folder:hover ~ .tree__row--nested'));
      log('hoverRailRuleExists', !!findRule('.tree__row--folder:hover ~ .tree__row--nested::after'));
      log('gapSmallerThanGroupGap', (function () {
        var tree = document.getElementById('tree');
        var cs = getComputedStyle(tree);
        var gap = parseFloat(cs.getPropertyValue('--tree-gap'));
        var group = parseFloat(cs.getPropertyValue('--tree-group'));
        return gap > 0 && group > gap;
      })());
      // The cascade keys off a hovered folder being followed by nested rows. :hover
      // cannot be evaluated here, so the structural half is what gets asserted: at least
      // one expanded folder exists and the rows after it are nested, which is exactly what
      // `.tree__row--folder:hover ~ .tree__row--nested` selects.
      var expandedFolder = document.querySelector('#tree .tree__row--folder.is-expanded');
      log('expandedFolderPresent', !!expandedFolder);
      log('hoverCascadeHasTargets', !!expandedFolder &&
        expandedFolder.nextElementSibling &&
        expandedFolder.nextElementSibling.classList.contains('tree__row--nested'));

      // ---- every tree glyph is a real SVG icon in the SVG namespace
      var treeSvgs = document.querySelectorAll('#tree svg.tree__glyph');
      log('treeIconsRendered', treeSvgs.length > 0);
      log('treeIconsInSvgNamespace', Array.prototype.every.call(treeSvgs, function (s) {
        return s.namespaceURI === 'http://www.w3.org/2000/svg' && !!s.getAttribute('viewBox');
      }));
      log('folderIconIsSvg', !!document.querySelector('#tree svg.tree__glyph--folder'));
      log('noBoxGlyphsLeft', document.querySelectorAll('#tree .tree__glyph--folder').length === 0 ||
        !Array.prototype.some.call(document.querySelectorAll('#tree .tree__glyph'), function (n) {
          return n.tagName === 'SPAN' && /[\u25a1\u25b1\u25a4]/.test(n.textContent);
        }));

      // ---- custom select: custom surface, real <select> underneath
      var host = document.getElementById('workspace-select');
      var native = host.querySelector('select.select__native');
      var trigger = host.querySelector('.select__trigger');
      log('railSelectIsCustom', !!trigger && !!native);
      log('nativeSelectHoldsValue', native.value === App.app.state.workspaceId);
      log('triggerShowsLabel', trigger.textContent.trim().length > 0);
      trigger.click();
      var list = host.querySelector('.select__list');
      log('listOpens', !list.classList.contains('is-hidden'));
      log('listIsListbox', list.getAttribute('role') === 'listbox');
      log('optionsMatchRows', list.children.length === native.options.length);
      log('expandedAnnounced', trigger.getAttribute('aria-expanded') === 'true');
      log('selectedOptionMarked', !!list.querySelector('[aria-selected="true"]'));
      var kb = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      list.dispatchEvent(kb);
      log('arrowMovesActive', !!list.querySelector('.select__option.is-active'));
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      log('escapeClosesList', list.classList.contains('is-hidden'));

      // ---- dialog: opens, traps, and resolves false on Cancel
      var confirmPromise = App.ui.confirm({
        title: 'Interact confirm',
        message: 'Testing the dialog.',
        danger: true,
        confirmLabel: 'Delete',
      });
      var dlg = document.querySelector('dialog[aria-labelledby^="dlg-title"]');
      log('dialogOpens', !!dlg && dlg.open === true);
      log('dialogHasBackdropRole', dlg.classList.contains('dialog--danger'));
      log('dialogFocusInside', dlg.contains(document.activeElement));
      log('destructiveFocusOnCancel', document.activeElement.textContent.trim() === 'Cancel');
      dlg.querySelector('.dialog__footer .btn').click(); // Cancel
      return confirmPromise.then(function (confirmed) {
        log('cancelResolvesFalse', confirmed === false);
        log('dialogRemovedFromDom', !document.querySelector('dialog[aria-labelledby^="dlg-title"]'));

        // ---- prompt: validates empty, resolves the typed value
        var promptPromise = App.ui.prompt({ title: 'Interact prompt', label: 'Name', value: '' });
        var pdlg = document.querySelector('dialog[aria-labelledby^="dlg-title"]');
        var field = pdlg.querySelector('.field__input');
        log('promptFocusesField', document.activeElement === field);
        pdlg.querySelector('button[type="submit"]').click(); // submit while empty
        log('emptySubmitBlocked', !!pdlg.querySelector('.field__message--error'));
        log('invalidAriaSet', field.getAttribute('aria-invalid') === 'true');
        field.value = '  Renamed value  ';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        pdlg.querySelector('button[type="submit"]').click();
        return promptPromise.then(function (value) {
          log('promptResolvesTrimmed', value === 'Renamed value');

          // ---- type-to-confirm gate stays disabled until the phrase matches
          var gatePromise = App.ui.dialog({
            title: 'Interact gate',
            danger: true,
            gate: { label: 'Type', phrase: 'delete everything' },
            confirmLabel: 'Delete everything',
          });
          var gdlg = document.querySelector('dialog[aria-labelledby^="dlg-title"]');
          var gbtn = gdlg.querySelector('button[type="submit"]');
          var gfield = gdlg.querySelector('.field__input');
          log('gateStartsDisabled', gbtn.disabled === true);
          gfield.value = 'delete everythin';
          gfield.dispatchEvent(new Event('input', { bubbles: true }));
          log('gateStillDisabledPartial', gbtn.disabled === true);
          gfield.value = 'delete everything';
          gfield.dispatchEvent(new Event('input', { bubbles: true }));
          log('gateUnlocksOnExact', gbtn.disabled === false);
          gdlg.querySelector('.dialog__footer .btn').click();
          return gatePromise.then(function () {
            log('noNativeDialogsLeft', typeof window.__PROMPT_CALLED__ === 'undefined');

            // ---- search replaces the tree, and clearing restores it
            // The term must match a note or file name: search deliberately does not index
            // folder names, which is why this is not the folder used above.
            var search = document.getElementById('search');
            search.value = 'Welcome';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            return new Promise(function (r) { setTimeout(r, 320); }).then(function () {
              log('searchReplacesTree', !!document.querySelector('.search-head'));
              log('searchResultsRendered', document.querySelectorAll('#tree .tree__row--note').length > 0);
              log('searchHeadHasCount', /result/.test(document.querySelector('.search-head').textContent));
              log('searchOmitsFolderNames', document.querySelectorAll('#tree .tree__row--folder').length === 0);
              search.value = '';
              search.dispatchEvent(new Event('input', { bubbles: true }));
              return new Promise(function (r) { setTimeout(r, 320); }).then(function () {
                log('clearingSearchRestoresTree', !!rowByLabel('All notes'));

                // ---- a folder does not fold up over the work inside it
                // The interaction, written down because it is the easiest thing to "simplify"
                // into a bug: pressing a folder whose contents you are on takes the toggle OFF
                // that content and leaves the folder open; the NEXT press closes it, because
                // nothing inside is toggled any more. First with a child folder toggled...
                var openParent = function () {
                  if (rowByLabel('Interact parent').getAttribute('aria-expanded') === 'false') rowByLabel('Interact parent').click();
                };
                openParent();
                rowByLabel('Interact child').click();
                rowByLabel('Interact parent').click();
                log('folderStaysOpenOverAToggledChild', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'true');
                log('thatPressMovedTheToggleToTheFolder',
                  App.app.state.selection.id === rowByLabel('Interact parent').getAttribute('data-id'));
                log('theChildIsStillOnScreen', !!rowByLabel('Interact child'));
                rowByLabel('Interact parent').click();
                log('theNextPressClosesIt', rowByLabel('Interact parent').getAttribute('aria-expanded') === 'false');

                // ...and then with a note filed directly in the folder, which is the case the
                // first version of this rule got wrong.
                var parentId = rowByLabel('Interact parent').getAttribute('data-id');
                return App.db.createNote(App.app.state.workspaceId, parentId, 'Interact note').then(function (note) {
                  App.app.render();
                  openParent();
                  rowByLabel('Interact note').click();
                  log('noteInTheFolderIsOpen', App.app.state.activeNoteId === note.id);
                  rowByLabel('Interact parent').click();
                  log('folderStaysOpenOverTheNoteBeingRead',
                    rowByLabel('Interact parent').getAttribute('aria-expanded') === 'true');
                  log('thatPressMovedTheToggleOffTheNote', App.app.state.activeNoteId === null);
                  rowByLabel('Interact parent').click();
                  log('theNextPressClosesThatToo',
                    rowByLabel('Interact parent').getAttribute('aria-expanded') === 'false');
                  return 'CHECK ' + out.join(' | ');
                });
              });
            });
          });
        });
      });
    }).catch(function (e) {
      return 'CHECK EXCEPTION ' + e.message + ' @ ' + String(e.stack || '').split('\n')[1];
    });
  });
};
