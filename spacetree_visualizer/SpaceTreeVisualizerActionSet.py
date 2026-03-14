"""
SpaceTreeVisualizerActionSet

ActionSet subclass for Peano4/ExaHype2 that streams the adaptive mesh tree to a
SpaceTreeVisualizer backend over TCP in real time.

Usage in a simulation script:
    from spacetree_visualizer import SpaceTreeVisualizerActionSet
    project.add_action_set_to_timestepping(
        SpaceTreeVisualizerActionSet(solver=my_solver, host="127.0.0.1", port=7421)
    )
"""

import os
import jinja2
import peano4.output
from peano4.solversteps.ActionSet import ActionSet


class SpaceTreeVisualizerActionSet(ActionSet):
    """
    Generates C++ code that streams Peano4 AMR cell data to the SpaceTreeVisualizer
    backend in real time using the binary wire protocol defined in protocol.md.

    Two C++ classes are generated:
      - STVConnection   — static singleton managing TCP sockets per MPI rank
      - SpaceTreeVisualizerSender — one instance per spacetree per sweep
    """

    def __init__(
        self,
        solver,
        host: str = "127.0.0.1",
        port: int = 7421,
        send_cell_data: bool = False,
        compress_threshold: int = 4096,
        pause_mode: bool = False,
    ):
        """
        Parameters
        ----------
        solver:
            ExaHype2 FV solver instance (e.g. exahype2.solvers.fv.musclhancock.GlobalAdaptiveTimeStep).
            Used at code-generation time to obtain the cell-data type name, patch size,
            and number of unknowns.
        host:
            Hostname or IP of the SpaceTreeVisualizer backend.
        port:
            TCP port of the backend (default 7421).
        send_cell_data:
            If True, the raw solver patch doubles are appended after each cell's geometry
            record (Phase 1.5). Sets the HAS_CELL_DATA handshake flag.
        compress_threshold:
            Byte threshold above which a cell batch is zlib-compressed before sending.
        pause_mode:
            If True, the sender blocks after each step waiting for a CONTINUE signal
            from the backend (pause-mode timeline). Sets the PAUSE_MODE handshake flag.
        """
        # Run after the solver's own action sets so we see final cell state
        super().__init__(descend_invocation_order=1, parallel=False)

        self._solver = solver
        self.d = {
            "STV_HOST": host,
            "STV_PORT": port,
            "STV_SEND_CELL_DATA": send_cell_data,
            "STV_COMPRESS_THRESHOLD": compress_threshold,
            "STV_PAUSE_MODE": pause_mode,
            # Derived from solver at codegen time
            "STV_CELL_DATA_TYPE": self._cell_data_type(),
            "STV_PATCH_SIZE": self._patch_size(),
            "STV_N_UNKNOWNS": self._n_unknowns(),
            "STV_N_AUX": self._n_aux(),
        }

    # ------------------------------------------------------------------
    # Solver introspection helpers (called at Python codegen time only)
    # ------------------------------------------------------------------

    def _cell_data_type(self) -> str:
        """C++ type name of the fine-grid cell data (e.g. 'CCZ4Q')."""
        try:
            return self._solver._unknown_identifier()
        except AttributeError:
            return ""

    def _patch_size(self) -> int:
        try:
            return self._solver._patch_size
        except AttributeError:
            return 1

    def _n_unknowns(self) -> int:
        try:
            return self._solver._variable_shortcuts.unknowns
        except AttributeError:
            return 0

    def _n_aux(self) -> int:
        try:
            return self._solver._variable_shortcuts.auxiliary_variables
        except AttributeError:
            return 0

    # ------------------------------------------------------------------
    # Template loading
    # ------------------------------------------------------------------

    def _template_dir(self) -> str:
        return os.path.join(os.path.dirname(__file__), "_templates")

    def _render(self, template_name: str) -> str:
        env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(self._template_dir()),
            undefined=jinja2.StrictUndefined,
        )
        return env.get_template(template_name).render(**self.d)

    # ------------------------------------------------------------------
    # ActionSet interface
    # ------------------------------------------------------------------

    def get_action_set_name(self) -> str:
        return "SpaceTreeVisualizerSender"

    def user_should_modify_template(self) -> bool:
        # Generated into observer/ — overwritten each codegen run
        return False

    def get_includes(self) -> str:
        return self._render("SpaceTreeVisualizerSender_includes.jinja2")

    def get_attributes(self) -> str:
        return self._render("SpaceTreeVisualizerSender_attributes.jinja2")

    def get_constructor_body(self) -> str:
        return self._render("SpaceTreeVisualizerSender_constructor.jinja2")

    def get_destructor_body(self) -> str:
        return "\n"

    def get_body_of_getGridControlEvents(self) -> str:
        return "return std::vector<peano4::grid::GridControlEvent>();\n"

    def get_static_initialisations(self, full_qualified_classname: str) -> str:
        d = dict(self.d)
        d["FQCN"] = full_qualified_classname
        env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(self._template_dir()),
            undefined=jinja2.StrictUndefined,
        )
        return env.get_template("SpaceTreeVisualizerSender_statics.jinja2").render(**d)

    def get_body_of_prepareTraversal(self) -> str:
        return self._render("SpaceTreeVisualizerSender_prepareTraversal.jinja2")

    def get_body_of_unprepareTraversal(self) -> str:
        return self._render("SpaceTreeVisualizerSender_unprepareTraversal.jinja2")

    def get_body_of_operation(self, operation_name: str) -> str:
        if operation_name == ActionSet.OPERATION_BEGIN_TRAVERSAL:
            return self._render("SpaceTreeVisualizerSender_beginTraversal.jinja2")
        if operation_name == ActionSet.OPERATION_END_TRAVERSAL:
            return self._render("SpaceTreeVisualizerSender_endTraversal.jinja2")
        if operation_name == ActionSet.OPERATION_TOUCH_CELL_FIRST_TIME:
            return self._render("SpaceTreeVisualizerSender_touchCellFirstTime.jinja2")
        return "\n"

    # ------------------------------------------------------------------
    # STVConnection file pair for Peano's output pipeline
    # ------------------------------------------------------------------

    def make_stv_connection_file_pair(self, namespace: list, subdirectory: str = "."):
        """
        Return a Jinja2TemplatedHeaderImplementationFilePair for STVConnection.

        Pass this to peano_project.output.add() so Peano's code-generation
        pipeline writes STVConnection.h/.cpp and registers them in the
        Makefile and .gitignore automatically.

        Example (in the simulation script)::

            stv = SpaceTreeVisualizerActionSet(solver=my_solver, port=7421)
            project.add_action_set_to_timestepping(stv)

            peano_project = project.generate_Peano4_project()

            conn = stv.make_stv_connection_file_pair(peano_project.namespace)
            peano_project.output.add(conn)
            peano_project.output.makefile.add_h_file(
                subdirectory + "STVConnection.h", generated=True)
            peano_project.output.makefile.add_cpp_file(
                subdirectory + "STVConnection.cpp", generated=True)

            peano_project.generate(...)
        """
        tmpl_dir = self._template_dir()
        return peano4.output.Jinja2TemplatedHeaderImplementationFilePair(
            os.path.join(tmpl_dir, "STVConnection.template.h"),
            os.path.join(tmpl_dir, "STVConnection.template.cpp"),
            "STVConnection",
            namespace,
            subdirectory,
            dict(self.d),
        )
