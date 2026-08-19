// Checker selection for checktourup.
// Loaded automatically by src/index.js into the existing HTML.
// No edit to dist/index.html is required.

(() => {
  const REPORT_PATH =
    '/api/send-report';

  const ALLOWED =
    [
      'Adrian',
      'Leo',
      'Liviu'
    ];

  const originalFetch =
    window.fetch.bind(
      window
    );

  let pendingChoice =
    null;

  function buildModal() {
    if (
      document.getElementById(
        'checkerChoiceOverlay'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.textContent = `
      #checkerChoiceOverlay{
        position:fixed;
        inset:0;
        z-index:99999;
        display:none;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(30,25,15,.58);
        backdrop-filter:blur(3px);
      }

      #checkerChoiceOverlay.open{
        display:flex;
      }

      .checker-choice-card{
        width:min(100%,390px);
        background:#FFFEF6;
        color:#3A3320;
        border:1px solid #B8A23A;
        border-radius:12px;
        box-shadow:0 18px 50px rgba(0,0,0,.28);
        padding:22px;
      }

      .checker-choice-card h2{
        margin:0 0 6px;
        font-family:'Courier New',monospace;
        font-size:20px;
        text-transform:uppercase;
      }

      .checker-choice-card p{
        margin:0 0 18px;
        color:#7D7248;
        font-size:14px;
        line-height:1.4;
      }

      .checker-options{
        display:grid;
        gap:9px;
        margin-bottom:16px;
      }

      .checker-option{
        display:flex;
        align-items:center;
        gap:10px;
        width:100%;
        padding:13px 14px;
        border:1px solid #E7D77B;
        border-radius:8px;
        background:#FFFDF0;
        cursor:pointer;
        font:inherit;
        color:#3A3320;
        text-align:left;
      }

      .checker-option:hover{
        background:#FDF4C5;
      }

      .checker-option.selected{
        border-color:#2F6B4F;
        background:#E3EEE6;
      }

      .checker-dot{
        width:18px;
        height:18px;
        border:2px solid #B8A23A;
        border-radius:50%;
        flex:0 0 auto;
      }

      .checker-option.selected .checker-dot{
        border:5px solid #2F6B4F;
      }

      #checkerSendBtn{
        width:100%;
        padding:12px 14px;
        border:1px solid #2F6B4F;
        border-radius:8px;
        background:#2F6B4F;
        color:white;
        font:inherit;
        font-weight:700;
        cursor:pointer;
      }

      #checkerSendBtn:disabled{
        opacity:.45;
        cursor:not-allowed;
      }

      .checker-required-note{
        margin-top:10px;
        font-size:11px;
        color:#7D7248;
        text-align:center;
      }
    `;

    document.head.appendChild(
      style
    );

    const overlay =
      document.createElement(
        'div'
      );

    overlay.id =
      'checkerChoiceOverlay';

    overlay.innerHTML = `
      <div
        class="checker-choice-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkerChoiceTitle"
      >
        <h2 id="checkerChoiceTitle">
          Who checked this?
        </h2>

        <p>
          Select the name of the person who completed
          this verification before the report is emailed.
        </p>

        <div
          class="checker-options"
          id="checkerOptions"
        ></div>

        <button
          type="button"
          id="checkerSendBtn"
          disabled
        >
          Send email
        </button>

        <div class="checker-required-note">
          A name is required to send the completed report.
        </div>
      </div>
    `;

    document.body.appendChild(
      overlay
    );

    const options =
      overlay.querySelector(
        '#checkerOptions'
      );

    const sendBtn =
      overlay.querySelector(
        '#checkerSendBtn'
      );

    let selected =
      '';

    ALLOWED.forEach(
      name => {
        const button =
          document.createElement(
            'button'
          );

        button.type =
          'button';

        button.className =
          'checker-option';

        button.innerHTML =
          `<span class="checker-dot"></span><strong>${name}</strong>`;

        button.addEventListener(
          'click',
          () => {
            selected =
              name;

            options
              .querySelectorAll(
                '.checker-option'
              )
              .forEach(
                el =>
                  el.classList.remove(
                    'selected'
                  )
              );

            button.classList.add(
              'selected'
            );

            sendBtn.disabled =
              false;
          }
        );

        options.appendChild(
          button
        );
      }
    );

    sendBtn.addEventListener(
      'click',
      () => {
        if (
          !selected ||
          !pendingChoice
        ) {
          return;
        }

        const resolver =
          pendingChoice;

        pendingChoice =
          null;

        overlay.classList.remove(
          'open'
        );

        resolver(
          selected
        );

        selected =
          '';

        sendBtn.disabled =
          true;

        options
          .querySelectorAll(
            '.checker-option'
          )
          .forEach(
            el =>
              el.classList.remove(
                'selected'
              )
          );
      }
    );
  }

  function chooseChecker() {
    buildModal();

    const overlay =
      document.getElementById(
        'checkerChoiceOverlay'
      );

    overlay.classList.add(
      'open'
    );

    return new Promise(
      resolve => {
        pendingChoice =
          resolve;
      }
    );
  }

  function isReportRequest(
    input
  ) {
    try {
      const rawUrl =
        typeof input ===
          'string'
          ? input
          : input.url;

      const url =
        new URL(
          rawUrl,
          location.origin
        );

      return (
        url.origin ===
          location.origin
        &&
        url.pathname ===
          REPORT_PATH
      );
    }
    catch (e) {
      return false;
    }
  }

  function parseBody(
    init
  ) {
    if (
      !init ||
      !init.body
    ) {
      return {};
    }

    if (
      typeof init.body !==
      'string'
    ) {
      return {};
    }

    try {
      return JSON.parse(
        init.body
      );
    }
    catch (e) {
      return {};
    }
  }

  // Intercept only the report endpoint.
  // All other requests continue unchanged.
  window.fetch =
    async function(
      input,
      init = {}
    ) {
      if (
        !isReportRequest(
          input
        )
      ) {
        return originalFetch(
          input,
          init
        );
      }

      const body =
        parseBody(
          init
        );

      // Keep the existing admin "test email" button
      // working without the checker dialog.
      if (
        body.force ===
        true
      ) {
        return originalFetch(
          input,
          init
        );
      }

      // If a checker is already supplied,
      // do not ask twice.
      if (
        ALLOWED.includes(
          body.checkedBy
        )
      ) {
        return originalFetch(
          input,
          init
        );
      }

      const checkedBy =
        await chooseChecker();

      const headers =
        new Headers(
          init.headers
          ||
          {}
        );

      headers.set(
        'content-type',
        'application/json'
      );

      return originalFetch(
        input,
        {
          ...init,
          method:
            init.method
            ||
            'POST',
          headers,
          body:
            JSON.stringify({
              ...body,
              checkedBy
            })
        }
      );
    };

  buildModal();
})();
