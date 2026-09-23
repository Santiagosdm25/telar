from telar.accounts.setup import graph_has_custom_prompt, next_setup_step


def test_next_step_order():
    assert next_setup_step(has_inbox=False, has_active_llm=False, has_custom_prompt=False) == "inbox"
    assert next_setup_step(has_inbox=True, has_active_llm=False, has_custom_prompt=False) == "llm"
    assert next_setup_step(has_inbox=True, has_active_llm=True, has_custom_prompt=False) == "prompt"
    assert next_setup_step(has_inbox=True, has_active_llm=True, has_custom_prompt=True) == "done"


def test_graph_has_custom_prompt():
    assert not graph_has_custom_prompt(None)
    assert not graph_has_custom_prompt({"nodes": [{"id": "a", "system_prompt": None}]})
    assert not graph_has_custom_prompt({"nodes": [{"id": "a", "system_prompt": "  "}]})
    assert graph_has_custom_prompt(
        {"nodes": [{"id": "a", "system_prompt": "Sos el asesor de Acme."}]}
    )
