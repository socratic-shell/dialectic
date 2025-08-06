// Diagram Enlarger - Click to enlarge Mermaid diagrams in modal overlay
(function() {
    'use strict';

    // Wait for page to load and Mermaid to render
    document.addEventListener('DOMContentLoaded', function() {
        // Give Mermaid time to render
        setTimeout(initializeDiagramEnlarger, 500);
    });

    function initializeDiagramEnlarger() {
        // Find all Mermaid diagrams
        const diagrams = document.querySelectorAll('.mermaid svg');
        
        diagrams.forEach(function(svg) {
            // Make diagrams clickable
            svg.style.cursor = 'zoom-in';
            svg.title = 'Click to enlarge';
            
            svg.addEventListener('click', function(e) {
                e.preventDefault();
                showEnlargedDiagram(svg);
            });
        });
    }

    function showEnlargedDiagram(originalSvg) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'diagram-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            cursor: zoom-out;
        `;

        // Clone the SVG for the modal
        const enlargedSvg = originalSvg.cloneNode(true);
        enlargedSvg.style.cssText = `
            max-width: 90vw;
            max-height: 90vh;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            cursor: zoom-out;
        `;

        // Add close instruction
        const closeHint = document.createElement('div');
        closeHint.textContent = 'Click anywhere or press ESC to close';
        closeHint.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-size: 14px;
            background: rgba(0, 0, 0, 0.6);
            padding: 8px 16px;
            border-radius: 4px;
            pointer-events: none;
        `;

        modal.appendChild(enlargedSvg);
        modal.appendChild(closeHint);
        document.body.appendChild(modal);

        // Prevent body scrolling while modal is open
        document.body.style.overflow = 'hidden';

        // Close modal on click
        modal.addEventListener('click', closeDiagramModal);

        // Close modal on ESC key
        document.addEventListener('keydown', handleEscapeKey);

        function closeDiagramModal() {
            document.body.removeChild(modal);
            document.body.style.overflow = '';
            document.removeEventListener('keydown', handleEscapeKey);
        }

        function handleEscapeKey(e) {
            if (e.key === 'Escape') {
                closeDiagramModal();
            }
        }
    }
})();
